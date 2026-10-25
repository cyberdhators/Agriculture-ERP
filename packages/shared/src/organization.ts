import { z } from 'zod';

import { ACCOUNT_PROFILE_MESSAGES, ACTIVITIES, GROUP_KINDS } from './account-profile';
import { BUYER_MESSAGES, buyerEmailSchema } from './buyer';
import { parseSouthSudanMobile } from './phone';

/**
 * ORGANISATIONAL PROFILES AND TEAM ACCESS (2026-10-27, CORWADO's 16 October
 * specification, "Organizational continuity"). docs/DECISIONS.md,
 * "Organisational profiles and team access".
 *
 * Each person signs in as themselves and may act for organisations they are a
 * member of. Membership carries a preset (Administrator, Contributor, Viewer)
 * and granular permissions. These are ORGANISATIONAL permissions only: nothing
 * here is a staff permission, and none of them reaches AgriOne verification,
 * advisory approval or administration.
 *
 * Everything in this file is pure. The routes load rows and ask these
 * functions; the tests ask them directly (packages/shared/tests/organization.test.ts).
 */

// ---------------------------------------------------------------------------
// KINDS, PRESETS, PERMISSIONS
// ---------------------------------------------------------------------------

/** What an organisation is. "Individual" is a person, never an organisation. */
export const ORG_PROFILE_KINDS = ['group', 'business', 'institution'] as const;
export type OrgProfileKind = (typeof ORG_PROFILE_KINDS)[number];

export const ORG_PERMISSIONS = [
  'profile.edit',
  'listings.manage',
  'inbox.read',
  'inbox.reply',
  'advisory.handle',
  'team.manage',
] as const;
export type OrgPermission = (typeof ORG_PERMISSIONS)[number];

/** What an administrator may give a contributor: everything but team management. */
export const GRANTABLE_ORG_PERMISSIONS = ORG_PERMISSIONS.filter(
  (p): p is Exclude<OrgPermission, 'team.manage'> => p !== 'team.manage',
);

/** A viewer reads; it never writes for the organisation. */
export const VIEWER_ORG_PERMISSIONS: readonly OrgPermission[] = ['inbox.read'];

export const ORG_PRESETS = ['administrator', 'contributor', 'viewer'] as const;
export type OrgPreset = (typeof ORG_PRESETS)[number];

export const ORG_PRESET_PERMISSIONS: Readonly<Record<OrgPreset, readonly OrgPermission[]>> = {
  administrator: ORG_PERMISSIONS,
  contributor: ['listings.manage', 'inbox.read', 'inbox.reply', 'advisory.handle'],
  viewer: ['inbox.read'],
};

export const ORG_PRESET_LABELS: Readonly<Record<OrgPreset, string>> = {
  administrator: 'Administrator',
  contributor: 'Contributor',
  viewer: 'Viewer',
};

export const ORG_PRESET_DESCRIPTIONS: Readonly<Record<OrgPreset, string>> = {
  administrator:
    'Manages the team, edits the profile, posts for the organisation and answers its messages.',
  contributor: 'Posts for the organisation and answers its messages. Cannot manage the team.',
  viewer: "Reads the organisation's messages. Cannot post, reply or change anything.",
};

export const ORG_PERMISSION_LABELS: Readonly<Record<OrgPermission, string>> = {
  'profile.edit': 'Edit the organisation profile',
  'listings.manage': 'Post and manage buying requests and services',
  'inbox.read': 'Read the shared inbox',
  'inbox.reply': 'Reply from the shared inbox',
  'advisory.handle': 'Handle advisory cases',
  'team.manage': 'Manage the team (administrators only)',
};

/** Days an invitation, or an offer of administration, stays open. */
export const ORG_INVITATION_DAYS = 7;

/** What the offering administrator becomes when a handover is accepted. */
export const ORG_SENDER_AFTER = ['administrator', 'contributor', 'viewer', 'leave'] as const;
export type OrgSenderAfter = (typeof ORG_SENDER_AFTER)[number];

/** The cookie that names the organisation a person is acting for. Checked on every request. */
export const ACTING_ORG_COOKIE = 'agri_acting_org';

// ---------------------------------------------------------------------------
// MESSAGES -- each pinned in docs/api/CONVENTIONS.md §5.2.3
// ---------------------------------------------------------------------------

export const ORGANIZATION_MESSAGES = {
  nameLength: 'Give the organisation a name of 2 to 120 characters.',
  kindUnknown: 'Choose group, business or institution.',
  aboutLength: 'Keep the description to 2000 characters.',
  locationLength: 'Keep the location to 200 characters.',
  statusUnknown: 'Choose draft or published.',
  channelUnknown: 'Choose phone or email.',
  presetUnknown: 'Choose Administrator, Contributor or Viewer.',
  permissionUnknown: 'Choose permissions from the list.',
  permissionsNotForPreset:
    'A Viewer can only read the shared inbox, and only an Administrator manages the team.',
  reasonLength: 'Give a reason of 3 to 300 characters.',
  evidenceLength: 'Describe the evidence in 3 to 300 characters.',
  confirmRequired: 'Tick the box to confirm.',
  tokenInvalid: 'This invitation link is not complete. Open the link from the invitation again.',
  respondTarget: 'Answer one invitation: give its link or its identifier, not both.',
  senderAfterUnknown: 'Choose what you become after the handover.',
  titleLength: 'Keep the title to 80 characters.',
  nothingToChange: 'Change something before saving.',
  passwordRequired: 'Enter your password to confirm.',
} as const;

const O = ORGANIZATION_MESSAGES;

// ---------------------------------------------------------------------------
// THE PERMISSION LOGIC
// ---------------------------------------------------------------------------

export interface MemberLike {
  readonly id: string;
  readonly preset: OrgPreset;
  readonly permissions: readonly string[];
  readonly status: 'active' | 'revoked' | 'left';
}

/**
 * The permissions a member with `preset` holds, given what was asked for.
 * An administrator always holds every permission. A contributor may hold any
 * grantable permission (the preset's set when nothing is asked). A viewer may
 * hold read-only permissions only. Null when the request is not allowed.
 * The result is in the canonical order of ORG_PERMISSIONS, without repeats.
 */
export function permissionsFor(
  preset: OrgPreset,
  requested?: readonly string[] | null,
): OrgPermission[] | null {
  if (preset === 'administrator') return [...ORG_PERMISSIONS];
  const wanted = requested ?? ORG_PRESET_PERMISSIONS[preset];
  const allowed: readonly string[] =
    preset === 'viewer' ? VIEWER_ORG_PERMISSIONS : GRANTABLE_ORG_PERMISSIONS;
  for (const p of wanted) if (!allowed.includes(p)) return null;
  return ORG_PERMISSIONS.filter((p) => wanted.includes(p));
}

/** Whether an ACTIVE member holds `permission`. Team management is the administrator's alone. */
export function memberMay(member: MemberLike | null | undefined, permission: OrgPermission): boolean {
  if (!member || member.status !== 'active') return false;
  if (permission === 'team.manage') return member.preset === 'administrator';
  if (member.preset === 'administrator') return true;
  return member.permissions.includes(permission);
}

export const activeAdministrators = (members: readonly MemberLike[]): MemberLike[] =>
  members.filter((m) => m.status === 'active' && m.preset === 'administrator');

/** The change an administrator, or the member themself, wants to make. */
export type MembershipChange = 'revoke' | 'leave' | 'demote';

/**
 * LAST-ADMINISTRATOR PROTECTION. Null when the change may go ahead, otherwise
 * the rule that refuses it. An open organisation always keeps one active
 * administrator: the last one hands over (with acceptance) or closes it.
 */
export function membershipChangeIssue(input: {
  members: readonly MemberLike[];
  targetId: string;
  change: MembershipChange;
}): 'organization_last_admin' | null {
  const target = input.members.find((m) => m.id === input.targetId);
  if (!target || target.status !== 'active' || target.preset !== 'administrator') return null;
  const others = activeAdministrators(input.members).filter((m) => m.id !== target.id);
  return others.length === 0 ? 'organization_last_admin' : null;
}

/** Whether the team page should encourage a second administrator. */
export const needsSecondAdministrator = (members: readonly MemberLike[]): boolean =>
  activeAdministrators(members).length < 2;

// ---------------------------------------------------------------------------
// INVITATIONS
// ---------------------------------------------------------------------------

export type InviteChannel = 'phone' | 'email';

/** A phone to +211 E.164, an email to lower case; or the reason it cannot be. */
export function normaliseInviteTarget(
  channel: InviteChannel,
  raw: string,
): { ok: true; value: string } | { ok: false; message: string } {
  if (channel === 'phone') {
    const parsed = parseSouthSudanMobile(raw);
    return parsed.ok ? { ok: true, value: parsed.value } : { ok: false, message: parsed.message };
  }
  const parsed = buyerEmailSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: parsed.error.issues[0]?.message ?? O.channelUnknown };
}

export interface InvitationLike {
  readonly kind: 'member' | 'transfer';
  readonly status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  readonly channel: InviteChannel | null;
  readonly target: string | null;
  readonly expiresAt: Date;
  /** Transfer only: the member it was offered to, and that member's sign-in. */
  readonly targetMemberAuthUserId?: string | null;
}

/** What the caller signed in as: verified contacts only. */
export interface CallerContacts {
  readonly authUserId: string;
  /** The +211 number of the account's sign-in, when it has one. */
  readonly phone: string | null;
  /** The sign-in email, lower case, when it is a real address. */
  readonly email: string | null;
}

export type InvitationIssue =
  | 'organization_invitation_not_pending'
  | 'organization_invitation_expired'
  | 'organization_invitation_other_account'
  | 'organization_already_member';

/** Whether an invitation may be shown, accepted or declined by this caller. */
export function invitationIsFor(invitation: InvitationLike, caller: CallerContacts): boolean {
  if (invitation.kind === 'transfer') {
    return invitation.targetMemberAuthUserId === caller.authUserId;
  }
  if (invitation.channel === 'phone') {
    return caller.phone !== null && invitation.target === caller.phone;
  }
  return caller.email !== null && invitation.target === caller.email.toLowerCase();
}

/**
 * Null when the caller may ACCEPT the invitation now. The recipient must be
 * signed in as the phone or email it was sent to (authentication); it must be
 * pending and unexpired; a member invitation cannot make a current member twice.
 */
export function acceptIssue(input: {
  invitation: InvitationLike;
  caller: CallerContacts;
  now: Date;
  alreadyMember: boolean;
}): InvitationIssue | null {
  const { invitation, caller, now } = input;
  if (invitation.status !== 'pending') return 'organization_invitation_not_pending';
  if (invitation.expiresAt.getTime() <= now.getTime()) return 'organization_invitation_expired';
  if (!invitationIsFor(invitation, caller)) return 'organization_invitation_other_account';
  if (invitation.kind === 'member' && input.alreadyMember) return 'organization_already_member';
  return null;
}

/** What an invitation reads as on a list: pending ones past their date are expired. */
export function invitationState(
  invitation: Pick<InvitationLike, 'status' | 'expiresAt'>,
  now: Date,
): 'pending' | 'expired' | 'accepted' | 'declined' | 'cancelled' {
  if (invitation.status === 'pending' && invitation.expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  return invitation.status;
}

/** The handover's effect on the offering administrator: their new preset, or null to leave. */
export const senderPresetAfter = (after: OrgSenderAfter): OrgPreset | null =>
  after === 'leave' ? null : after;

// ---------------------------------------------------------------------------
// PERSONAL DELETION -- the defined resolution process
// ---------------------------------------------------------------------------

export interface DeletionMembership {
  readonly organizationId: string;
  readonly member: MemberLike;
  /** Every member of that organisation, the leaver included. */
  readonly members: readonly MemberLike[];
}

/**
 * When a person deletes their account, each organisation they belong to is
 * either LEFT (someone else administers it, or they are not an administrator)
 * or must be CLOSED (they are its last administrator). Closing is the
 * person's own choice and needs nobody else, so deletion is never blocked
 * indefinitely; handing over first is the alternative.
 */
export function deletionResolution(memberships: readonly DeletionMembership[]): {
  leave: string[];
  mustClose: string[];
} {
  const leave: string[] = [];
  const mustClose: string[] = [];
  for (const m of memberships) {
    if (m.member.status !== 'active') continue;
    const issue = membershipChangeIssue({
      members: m.members,
      targetId: m.member.id,
      change: 'leave',
    });
    (issue ? mustClose : leave).push(m.organizationId);
  }
  return { leave, mustClose };
}

// ---------------------------------------------------------------------------
// SCHEMAS -- the same on the phone and the server
// ---------------------------------------------------------------------------

const idSchema = z
  .string({ error: () => BUYER_MESSAGES.identifierMalformed })
  .uuid(BUYER_MESSAGES.identifierMalformed);

const optionalText = (max: number, message: string) =>
  z
    .string({ error: () => message })
    .trim()
    .max(max, message)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const orgFields = {
  name: z
    .string({ error: () => O.nameLength })
    .trim()
    .min(2, O.nameLength)
    .max(120, O.nameLength),
  profile_kind: z.enum(ORG_PROFILE_KINDS, { error: () => O.kindUnknown }),
  group_kind: z
    .enum(GROUP_KINDS, { error: () => ACCOUNT_PROFILE_MESSAGES.groupKindRequired })
    .nullable()
    .optional(),
  activities: z
    .array(z.enum(ACTIVITIES, { error: () => ACCOUNT_PROFILE_MESSAGES.activityUnknown }))
    .refine((list) => new Set(list).size === list.length, {
      message: ACCOUNT_PROFILE_MESSAGES.activitiesDuplicate,
    }),
  about: optionalText(2000, O.aboutLength),
  state_id: z
    .string({ error: () => BUYER_MESSAGES.identifierMalformed })
    .trim()
    .min(1, BUYER_MESSAGES.identifierMalformed)
    .max(64, BUYER_MESSAGES.identifierMalformed)
    .nullable()
    .optional(),
  location: optionalText(200, O.locationLength),
  public_phone: z
    .string()
    .transform((raw, ctx) => {
      if (raw.trim() === '') return null;
      const parsed = parseSouthSudanMobile(raw);
      if (!parsed.ok) {
        ctx.addIssue({ code: 'custom', message: parsed.message });
        return z.NEVER;
      }
      return parsed.value;
    })
    .nullable()
    .optional(),
  public_email: z
    .union([z.literal('').transform(() => null), buyerEmailSchema])
    .nullable()
    .optional(),
  show_team: z.boolean({ error: () => O.confirmRequired }).optional(),
};

const groupKindRule = (
  value: { profile_kind?: OrgProfileKind; group_kind?: string | null },
  ctx: z.RefinementCtx,
) => {
  if (value.profile_kind === undefined) return;
  const hasGroupKind = value.group_kind !== null && value.group_kind !== undefined;
  if (value.profile_kind === 'group' && !hasGroupKind) {
    ctx.addIssue({
      code: 'custom',
      path: ['group_kind'],
      message: ACCOUNT_PROFILE_MESSAGES.groupKindRequired,
    });
  }
  if (value.profile_kind !== 'group' && hasGroupKind) {
    ctx.addIssue({
      code: 'custom',
      path: ['group_kind'],
      message: ACCOUNT_PROFILE_MESSAGES.groupKindOnlyForGroups,
    });
  }
};

/** "Create an organisation profile". The creator becomes its first administrator. */
export const createOrganizationSchema = z
  .strictObject({ ...orgFields, activities: orgFields.activities.default([]) })
  .superRefine(groupKindRule);
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** Editing the profile (profile.edit), and publishing or unpublishing it. */
export const updateOrganizationSchema = z
  .strictObject({
    name: orgFields.name.optional(),
    profile_kind: orgFields.profile_kind.optional(),
    group_kind: orgFields.group_kind,
    activities: orgFields.activities.optional(),
    about: orgFields.about,
    state_id: orgFields.state_id,
    location: orgFields.location,
    public_phone: orgFields.public_phone,
    public_email: orgFields.public_email,
    show_team: orgFields.show_team,
    status: z.enum(['draft', 'published'], { error: () => O.statusUnknown }).optional(),
  })
  .superRefine(groupKindRule)
  .refine((v) => Object.keys(v).length > 0, { message: O.nothingToChange });
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

const presetSchema = z.enum(ORG_PRESETS, { error: () => O.presetUnknown });
const permissionsSchema = z
  .array(z.enum(ORG_PERMISSIONS, { error: () => O.permissionUnknown }))
  .max(ORG_PERMISSIONS.length, O.permissionUnknown);

/** An invitation to a phone or an email, with the role it will carry. */
export const inviteMemberSchema = z
  .strictObject({
    channel: z.enum(['phone', 'email'], { error: () => O.channelUnknown }),
    target: z.string({ error: () => O.channelUnknown }).max(254, O.channelUnknown),
    preset: presetSchema,
    permissions: permissionsSchema.optional(),
  })
  .transform((value, ctx) => {
    const target = normaliseInviteTarget(value.channel, value.target);
    if (!target.ok) {
      ctx.addIssue({ code: 'custom', path: ['target'], message: target.message });
      return z.NEVER;
    }
    const permissions = permissionsFor(value.preset, value.permissions);
    if (!permissions) {
      ctx.addIssue({ code: 'custom', path: ['permissions'], message: O.permissionsNotForPreset });
      return z.NEVER;
    }
    return { channel: value.channel, target: target.value, preset: value.preset, permissions };
  });
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/**
 * An administrator changes a member's preset or permissions. Administrator is
 * not on offer here: becoming one needs the person's acceptance (a handover).
 */
export const updateMemberSchema = z
  .strictObject({
    preset: z.enum(['contributor', 'viewer'], { error: () => O.presetUnknown }).optional(),
    permissions: permissionsSchema.optional(),
  })
  .refine((v) => v.preset !== undefined || v.permissions !== undefined, {
    message: O.nothingToChange,
  });
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

/** The member's own choices: whether they appear on the public profile, and how. */
export const myMembershipSchema = z
  .strictObject({
    show_on_profile: z.boolean({ error: () => O.confirmRequired }).optional(),
    public_title: optionalText(80, O.titleLength),
  })
  .refine((v) => Object.keys(v).length > 0, { message: O.nothingToChange });
export type MyMembershipInput = z.infer<typeof myMembershipSchema>;

const reasonSchema = z
  .string({ error: () => O.reasonLength })
  .trim()
  .min(3, O.reasonLength)
  .max(300, O.reasonLength);

/** Ending a member's access. The reason is kept on the membership and in the audit. */
export const revokeMemberSchema = z.strictObject({ reason: reasonSchema });

/** Offering administration to an existing member (needs their acceptance). */
export const offerTransferSchema = z.strictObject({
  member_id: idSchema,
  sender_after: z.enum(ORG_SENDER_AFTER, { error: () => O.senderAfterUnknown }),
});
export type OfferTransferInput = z.infer<typeof offerTransferSchema>;

/** Closing the organisation: records stay; access, posts and conversations end. */
export const closeOrganizationSchema = z.strictObject({
  reason: reasonSchema,
  confirm: z.literal(true, { error: () => O.confirmRequired }),
});

/** Switching who the person acts as: an organisation, or null for themselves. */
export const actingAsSchema = z.strictObject({
  organization_id: idSchema.nullable(),
});

/** Answering an invitation: by its link's token, or by its id from the in-app list. */
export const respondInvitationSchema = z
  .strictObject({
    token: z
      .string({ error: () => O.tokenInvalid })
      .regex(/^[A-Za-z0-9_-]{43}$/, O.tokenInvalid)
      .optional(),
    invitation_id: idSchema.optional(),
    accept: z.boolean({ error: () => O.confirmRequired }),
  })
  .refine((v) => (v.token === undefined) !== (v.invitation_id === undefined), {
    message: O.respondTarget,
  });
export type RespondInvitationInput = z.infer<typeof respondInvitationSchema>;

/** Staff: evidence-based exceptional recovery of an organisation's administration. */
export const recoverOrganizationSchema = z.strictObject({
  member_id: idSchema,
  reason: reasonSchema,
  evidence: z
    .string({ error: () => O.evidenceLength })
    .trim()
    .min(3, O.evidenceLength)
    .max(300, O.evidenceLength),
  password: z
    .string({ error: () => O.passwordRequired })
    .min(1, O.passwordRequired)
    .max(200, O.passwordRequired),
});
export type RecoverOrganizationInput = z.infer<typeof recoverOrganizationSchema>;

// ---------------------------------------------------------------------------
// SHAPES THE API RETURNS
// ---------------------------------------------------------------------------

export interface OrganizationSummary {
  id: string;
  name: string;
  profile_kind: OrgProfileKind;
  group_kind: string | null;
  activities: string[];
  about: string | null;
  state_id: string | null;
  location: string | null;
  public_phone: string | null;
  public_email: string | null;
  show_team: boolean;
  status: 'draft' | 'published';
  closed: boolean;
  created_at: string;
}

export interface MyOrganization extends OrganizationSummary {
  member_id: string;
  preset: OrgPreset;
  permissions: OrgPermission[];
  show_on_profile: boolean;
  public_title: string | null;
}

export interface TeamMember {
  id: string;
  name: string;
  preset: OrgPreset;
  permissions: OrgPermission[];
  status: 'active' | 'revoked' | 'left';
  is_me: boolean;
  show_on_profile: boolean;
  public_title: string | null;
  joined_at: string;
  ended_at: string | null;
  end_reason: string | null;
}

export interface InvitationSummary {
  id: string;
  organization_id: string;
  organization_name: string;
  kind: 'member' | 'transfer';
  channel: InviteChannel | null;
  /** Shown to the organisation's administrators only, never to the recipient's list. */
  target: string | null;
  target_member_id: string | null;
  preset: OrgPreset;
  permissions: OrgPermission[];
  sender_after: OrgSenderAfter | null;
  state: 'pending' | 'expired' | 'accepted' | 'declined' | 'cancelled';
  delivery: string;
  expires_at: string;
  created_at: string;
}

export interface ActingAs {
  organization_id: string | null;
  organization_name: string | null;
  preset: OrgPreset | null;
  permissions: OrgPermission[];
}
