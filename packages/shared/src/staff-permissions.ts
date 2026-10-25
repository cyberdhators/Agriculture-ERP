import { z } from 'zod';

/**
 * STAFF PERMISSIONS, SUPER ADMIN AND ACCESS LOGS (CORWADO specification of
 * 16 October 2026, the administration part). 2026-10-19.
 *
 * 2026-10-30: PRESETS ARE BINDING. Until then an account with the role
 * `admin` held every permission except Super Admin without any grant (the
 * "legacy rule"), so the Moderator + Editor, Support, Analyst and
 * Administrator presets restricted nothing for an administrator. Now a staff
 * member's permissions are exactly the union of their ACTIVE preset grants;
 * the role still decides which routes a person may knock on (requireRole) and,
 * for a supervisor or read-only account, the state their data is limited to,
 * but the role alone grants no permission. Migration
 * 20261030090000_presets_binding_keep_admin_powers gave every administrator
 * who had no grant the presets that together equal what the legacy rule gave
 * them, so nobody lost access on the day it landed (docs/DECISIONS.md).
 *
 * Everything in this file is pure: the presets, the effective-permission
 * calculation, the Super Admin rules, the return-session classifier and the
 * device label. The routes load rows and ask these functions; the tests ask
 * them directly, with no database.
 */

// ---------------------------------------------------------------------------
// KEYS AND PRESETS
// ---------------------------------------------------------------------------

/** Granular permission keys. A route asks for exactly one. */
export const PERMISSION_KEYS = [
  'staff.manage',
  'superadmin.grant',
  'content.moderate',
  'content.publish',
  'reports.view',
  'support.handle',
  'audit.view',
  'settings.manage',
  'exports.identifiable',
  // 2026-10-27: official announcements and message templates (Communications).
  'communications.send',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** Named bundles a staff member is given. One person may hold several. */
export const STAFF_PRESETS = [
  'super_admin',
  'administrator',
  'moderator_editor',
  'analyst',
  'support',
] as const;

export type StaffPreset = (typeof STAFF_PRESETS)[number];

/** Every preset except Super Admin, which is granted only through delegation. */
export const ORDINARY_PRESETS = STAFF_PRESETS.filter(
  (p): p is Exclude<StaffPreset, 'super_admin'> => p !== 'super_admin',
);

/**
 * What each preset carries.
 *
 * THE SPECIFICATION'S FENCE: platform-wide moderation or editing never implies
 * Super Admin, security changes or sensitive exports. So `superadmin.grant`
 * and `exports.identifiable` appear in exactly one preset, and a test asserts
 * that no other preset reaches them -- however wide its scope.
 */
export const PRESET_PERMISSIONS: Readonly<Record<StaffPreset, readonly PermissionKey[]>> = {
  super_admin: PERMISSION_KEYS,
  // "Settings and staff, as assigned": manages staff presets within its scope,
  // the settings, and reads the trail and the reports it needs to do so.
  // 2026-10-27: and official announcements, which reach every account.
  administrator: [
    'staff.manage',
    'settings.manage',
    'audit.view',
    'reports.view',
    'communications.send',
  ],
  moderator_editor: ['content.moderate', 'content.publish'],
  analyst: ['reports.view'],
  support: ['support.handle'],
};

export const PRESET_LABELS: Readonly<Record<StaffPreset, string>> = {
  super_admin: 'Super Admin',
  administrator: 'Administrator',
  moderator_editor: 'Moderator + Editor',
  analyst: 'Analyst',
  support: 'Support',
};

export const PRESET_DESCRIPTIONS: Readonly<Record<StaffPreset, string>> = {
  super_admin: 'Everything, including appointing other Super Admins.',
  administrator: 'Settings, staff and official announcements, as assigned.',
  moderator_editor: 'Moderate content and listings.',
  analyst: 'View data and reports.',
  support: 'Assist users and resolve issues.',
};

export const PERMISSION_LABELS: Readonly<Record<PermissionKey, string>> = {
  'staff.manage': 'Manage staff permissions',
  'superadmin.grant': 'Appoint Super Admins and end sessions',
  'content.moderate': 'Moderate content and listings',
  'content.publish': 'Publish content',
  'reports.view': 'View data and reports',
  'support.handle': 'Assist users and resolve issues',
  'audit.view': 'View access logs and the audit trail',
  'settings.manage': 'Manage settings',
  'exports.identifiable': 'Export identifiable data',
  'communications.send': 'Send official announcements and manage message templates',
};

/**
 * THE ROLLOUT OF 2026-10-30. Before presets became binding an `admin` held
 * every key except `superadmin.grant` (and `exports.identifiable`, which no
 * route asks for yet, now belongs to Super Admin alone). Migration
 * 20261030090000 gave every active administrator with no active grant these
 * three presets, platform-wide, so that their union is exactly what they held
 * before minus `exports.identifiable` -- a test asserts it. Kept here only as
 * the record of that migration; nothing reads it to decide a permission.
 */
export const ROLLOUT_PRESETS_FOR_ADMINS_WITHOUT_GRANTS = [
  'administrator',
  'moderator_editor',
  'support',
] as const satisfies readonly StaffPreset[];

/** The reason written on each grant that migration made. */
export const ROLLOUT_GRANT_REASON = 'Kept their powers when presets became binding (2026-10-30)';

// ---------------------------------------------------------------------------
// SCOPE AND EFFECTIVE PERMISSIONS
// ---------------------------------------------------------------------------

/** Where a grant applies, or where a route asks for a permission. */
export type PermissionScope =
  { readonly kind: 'platform' } | { readonly kind: 'states'; readonly stateIds: readonly string[] };

export const PLATFORM: PermissionScope = { kind: 'platform' };

/** How far a held permission reaches: everywhere, or these states. */
export type Coverage =
  { readonly platform: true } | { readonly platform: false; readonly states: ReadonlySet<string> };

export interface GrantLike {
  readonly preset: StaffPreset;
  readonly scope: PermissionScope;
}

export interface PermissionSubject {
  /** The staff role from requireRole. Officers, buyers and farmers hold nothing. */
  readonly role: string;
  /** ACTIVE grants only. A revoked grant is not passed in. */
  readonly grants: readonly GrantLike[];
}

export type EffectivePermissions = ReadonlyMap<PermissionKey, Coverage>;

const STAFF_ROLES = new Set(['admin', 'supervisor', 'read_only']);

/**
 * What a staff member may do, and where: the union of every active grant, and
 * nothing else. The role grants no permission (2026-10-30; before then an
 * `admin` held almost everything without a grant). A platform grant swallows
 * any state grant of the same key.
 *
 * A Super Admin grant counts only for an `admin`. The delegation route refuses
 * to give it to anyone else; this is the second line, so an administrator later
 * changed to supervisor stops being a Super Admin at once rather than keeping
 * national powers on a state-scoped account.
 */
export function effectivePermissions(subject: PermissionSubject): EffectivePermissions {
  const out = new Map<PermissionKey, Coverage>();
  if (!STAFF_ROLES.has(subject.role)) return out;

  const widen = (key: PermissionKey, scope: PermissionScope) => {
    const current = out.get(key);
    if (current?.platform) return;
    if (scope.kind === 'platform') {
      out.set(key, { platform: true });
      return;
    }
    const states = new Set(current && !current.platform ? current.states : []);
    for (const s of scope.stateIds) states.add(s);
    out.set(key, { platform: false, states });
  };

  for (const grant of subject.grants) {
    if (grant.preset === 'super_admin' && subject.role !== 'admin') continue;
    for (const key of PRESET_PERMISSIONS[grant.preset]) widen(key, grant.scope);
  }
  return out;
}

/**
 * Whether a held coverage reaches the requested scope. A platform request needs
 * platform coverage; a states request needs every one of those states. An empty
 * states request is refused: "nowhere in particular" is not a scope.
 */
export function covers(coverage: Coverage | undefined, requested: PermissionScope): boolean {
  if (!coverage) return false;
  if (coverage.platform) return true;
  if (requested.kind === 'platform') return false;
  if (requested.stateIds.length === 0) return false;
  return requested.stateIds.every((s) => coverage.states.has(s));
}

/** The question every new route asks. Scope omitted means the whole platform. */
export function holdsPermission(
  permissions: EffectivePermissions,
  key: PermissionKey,
  scope: PermissionScope = PLATFORM,
): boolean {
  return covers(permissions.get(key), scope);
}

/** A Super Admin is whoever holds `superadmin.grant` at platform scope. */
export const isSuperAdmin = (permissions: EffectivePermissions): boolean =>
  holdsPermission(permissions, 'superadmin.grant');

// ---------------------------------------------------------------------------
// SUPER ADMIN RULES
// ---------------------------------------------------------------------------

export type SuperAdminGrantDecision =
  | { readonly allowed: true; readonly bootstrap: boolean }
  | {
      readonly allowed: false;
      readonly reason: 'not_super_admin' | 'target_not_admin' | 'already_super_admin';
    };

/**
 * May this granter make this target a Super Admin?
 *
 * - A Super Admin may appoint any OTHER active administrator.
 * - BOOTSTRAP: while no Super Admin exists at all, an administrator may appoint
 *   THEMSELVES, and only themselves. Nobody holds `superadmin.grant` before the
 *   first one exists, so without this the role could never be filled.
 * - The target must be an `admin`: Super Admin is national, and a state-scoped
 *   account carrying national powers is the confusion C-3.4 exists to prevent.
 *
 * Re-authentication and the explicit confirmation are checked by the route
 * before this is asked; this decides only who may appoint whom.
 */
export function superAdminGrantDecision(input: {
  readonly granterId: string;
  readonly granterRole: string;
  readonly granterIsSuperAdmin: boolean;
  readonly targetId: string;
  readonly targetRole: string;
  readonly activeSuperAdminIds: readonly string[];
}): SuperAdminGrantDecision {
  if (input.targetRole !== 'admin') return { allowed: false, reason: 'target_not_admin' };
  if (input.activeSuperAdminIds.includes(input.targetId)) {
    return { allowed: false, reason: 'already_super_admin' };
  }
  if (input.granterIsSuperAdmin) return { allowed: true, bootstrap: false };
  const bootstrap =
    input.activeSuperAdminIds.length === 0 &&
    input.granterRole === 'admin' &&
    input.granterId === input.targetId;
  return bootstrap
    ? { allowed: true, bootstrap: true }
    : { allowed: false, reason: 'not_super_admin' };
}

/**
 * THE LAST SUPER ADMIN IS PROTECTED. Revoking, removing or demoting the only
 * active Super Admin would leave nobody able to appoint one, and the bootstrap
 * would then hand the role to whichever administrator asked first. Refused
 * unless another active Super Admin remains.
 *
 * `activeSuperAdminIds` is read under a lock by the caller, so two concurrent
 * revocations cannot each see the other as "the one who remains".
 */
export function mayLoseSuperAdmin(
  activeSuperAdminIds: readonly string[],
  targetId: string,
): boolean {
  if (!activeSuperAdminIds.includes(targetId)) return true;
  return activeSuperAdminIds.some((id) => id !== targetId);
}

// ---------------------------------------------------------------------------
// REQUEST SCHEMAS
// ---------------------------------------------------------------------------

export const STAFF_PERMISSION_MESSAGES = {
  reasonRequired: 'Give a reason of at least five characters. It is kept in the audit trail.',
  reasonTooLong: 'Keep the reason under 500 characters.',
  statesRequired: 'Choose at least one state, or apply the preset to the whole platform.',
  statesForbidden: 'A platform-wide preset is not limited to states. Remove the states.',
  confirmRequired: 'Tick the box to confirm.',
  passwordRequired: 'Enter your own password to confirm.',
  totpShape: 'Enter the six-digit code from your authenticator app.',
} as const;

const reasonSchema = z
  .string({ error: () => STAFF_PERMISSION_MESSAGES.reasonRequired })
  .trim()
  .min(5, STAFF_PERMISSION_MESSAGES.reasonRequired)
  .max(500, STAFF_PERMISSION_MESSAGES.reasonTooLong);

const uuid = z.string().uuid();

/**
 * The granter's own password, for re-authentication. Never stored, never
 * logged, never audited (`password` is on the audit denylist regardless). No
 * length rule beyond "present": a wrong password is the server's answer, and a
 * length hint would only describe the real one.
 */
const reauthPasswordSchema = z
  .string({ error: () => STAFF_PERMISSION_MESSAGES.passwordRequired })
  .min(1, STAFF_PERMISSION_MESSAGES.passwordRequired)
  .max(256, STAFF_PERMISSION_MESSAGES.passwordRequired);

const confirmSchema = z.literal(true, { error: () => STAFF_PERMISSION_MESSAGES.confirmRequired });

/** Optional: required by the server only when the granter has a verified TOTP factor. */
const totpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, STAFF_PERMISSION_MESSAGES.totpShape)
  .optional();

/** POST /api/admin/staff-access/grants. Never Super Admin: that has its own route. */
export const grantPresetSchema = z
  .strictObject({
    user_id: uuid,
    preset: z.enum(ORDINARY_PRESETS as unknown as [string, ...string[]]),
    scope: z.enum(['platform', 'states']),
    state_ids: z.array(z.string().trim().min(1).max(32)).max(20).optional(),
    reason: reasonSchema,
  })
  .superRefine((value, ctx) => {
    const states = value.state_ids ?? [];
    if (value.scope === 'states' && states.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['state_ids'],
        message: STAFF_PERMISSION_MESSAGES.statesRequired,
      });
    }
    if (value.scope === 'platform' && states.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['state_ids'],
        message: STAFF_PERMISSION_MESSAGES.statesForbidden,
      });
    }
  });

/** POST /api/admin/staff-access/grants/[id]/revoke */
export const revokeGrantSchema = z.strictObject({ reason: reasonSchema });

/** POST /api/admin/staff-access/super-admin */
export const superAdminGrantSchema = z.strictObject({
  user_id: uuid,
  reason: reasonSchema,
  password: reauthPasswordSchema,
  confirm: confirmSchema,
  totp_code: totpSchema,
});

/** POST /api/admin/staff-access/super-admin/[id]/revoke */
export const superAdminRevokeSchema = z.strictObject({
  reason: reasonSchema,
  password: reauthPasswordSchema,
  confirm: confirmSchema,
  totp_code: totpSchema,
});

/** POST /api/admin/staff-access/users/[id]/revoke-sessions */
export const revokeSessionsSchema = z.strictObject({
  reason: reasonSchema,
  confirm: confirmSchema,
});

export type GrantPresetInput = z.infer<typeof grantPresetSchema>;
export type RevokeGrantInput = z.infer<typeof revokeGrantSchema>;
export type SuperAdminGrantInput = z.infer<typeof superAdminGrantSchema>;
export type SuperAdminRevokeInput = z.infer<typeof superAdminRevokeSchema>;
export type RevokeSessionsInput = z.infer<typeof revokeSessionsSchema>;

/** The scope a validated grant body describes. */
export const scopeOfGrantInput = (input: {
  readonly scope: 'platform' | 'states';
  readonly state_ids?: readonly string[] | undefined;
}): PermissionScope =>
  input.scope === 'platform'
    ? PLATFORM
    : { kind: 'states', stateIds: [...new Set(input.state_ids ?? [])].sort() };

// ---------------------------------------------------------------------------
// ACCESS LOGS
// ---------------------------------------------------------------------------

/**
 * What the access log records, per account. `account_created` is written by a
 * database trigger on the account tables; the others by the "me" routes and by
 * the Super Admin re-authentication step.
 *
 * `reauth_failed` is a wrong password at re-authentication. `sign_in_failed`
 * (2026-10-28) is a wrong password at sign-in for an account that exists:
 * the app's sign-in screens now sign in through POST /api/auth/sign-in, so a
 * server sees each attempt. An identifier with no account is never recorded
 * here (there is no account to record it against).
 */
export const ACCESS_EVENTS = [
  'account_created',
  'first_sign_in',
  'sign_in',
  'return_session',
  'reauth_failed',
  'sign_in_failed',
] as const;

export type AccessEvent = (typeof ACCESS_EVENTS)[number];

export const ACCESS_EVENT_LABELS: Readonly<Record<AccessEvent, string>> = {
  account_created: 'Account created',
  first_sign_in: 'First sign-in',
  sign_in: 'Sign-in',
  return_session: 'Return session',
  reauth_failed: 'Failed re-authentication',
  sign_in_failed: 'Failed sign-in',
};

export const ACCESS_PRINCIPAL_KINDS = ['user', 'officer', 'buyer', 'farmer'] as const;
export type AccessPrincipalKind = (typeof ACCESS_PRINCIPAL_KINDS)[number];

/**
 * A RETURN SESSION is an already-authenticated visit after more than this long
 * without activity. Thirty minutes, as the specification sets it.
 */
export const RETURN_SESSION_INACTIVITY_MS = 30 * 60 * 1000;

/** The portal displays access times in South Sudan's time zone (UTC+2, no DST). */
export const DISPLAY_TIME_ZONE = 'Africa/Juba';
/** The fixed offset that zone has had since 2021, for turning a picked date into an instant. */
export const DISPLAY_UTC_OFFSET = '+02:00';

/**
 * What one authenticated visit means for the log, given what the log already
 * knows about the account.
 *
 * - The first visit ever recorded for an account is its first sign-in.
 * - A visit the sign-in screen announced (it calls /api/me straight after a
 *   successful password sign-in) is a sign-in.
 * - Otherwise, a visit after more than RETURN_SESSION_INACTIVITY_MS of silence
 *   is a return session: the person came back to a session still open.
 * - Anything else is ordinary activity: it moves "last activity" and writes no
 *   event, so the log is not a page-view counter.
 */
export function classifyVisit(input: {
  readonly firstSignInAt: Date | null;
  readonly lastSeenAt: Date | null;
  readonly now: Date;
  readonly signInAnnounced: boolean;
  /**
   * 2026-10-27 (settings phase 2): the inactivity threshold from Registration
   * and recovery. Omitted, the specification's thirty minutes.
   */
  readonly inactivityMs?: number;
}): Exclude<AccessEvent, 'account_created' | 'reauth_failed' | 'sign_in_failed'> | null {
  if (!input.firstSignInAt) return 'first_sign_in';
  if (input.signInAnnounced) return 'sign_in';
  if (!input.lastSeenAt) return 'return_session';
  const idle = input.now.getTime() - input.lastSeenAt.getTime();
  return idle > (input.inactivityMs ?? RETURN_SESSION_INACTIVITY_MS) ? 'return_session' : null;
}

/**
 * At most a minimal device label. The raw user agent is never stored -- it is
 * a fingerprint -- and neither is an IP address. This keeps only the platform
 * family, which is what an administrator needs to ask "was that you, on your
 * phone?".
 */
export const DEVICE_LABELS = ['android', 'ios', 'windows', 'mac', 'linux', 'other'] as const;
export type DeviceLabel = (typeof DEVICE_LABELS)[number];

export const DEVICE_LABEL_TEXT: Readonly<Record<DeviceLabel, string>> = {
  android: 'Android',
  ios: 'iPhone or iPad',
  windows: 'Windows',
  mac: 'Mac',
  linux: 'Linux',
  other: 'Other device',
};

export function deviceLabel(userAgent: string | null | undefined): DeviceLabel | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'mac';
  if (ua.includes('linux') || ua.includes('cros')) return 'linux';
  return 'other';
}

/** GET /api/admin/access-logs filters. Every one optional, validated before any query. */
export const accessLogFilterSchema = z.strictObject({
  /** Part of a staff or officer name. Farmers and buyers are found by id only. */
  name: z.string().trim().min(2).max(80).optional(),
  actor_kind: z.enum(ACCESS_PRINCIPAL_KINDS).optional(),
  actor_id: uuid.optional(),
  event: z.enum(ACCESS_EVENTS).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

export type AccessLogFilter = z.infer<typeof accessLogFilterSchema>;

/** The header the sign-in screen sends on its one /api/me call after signing in. */
export const SIGN_IN_ANNOUNCE_HEADER = 'x-agri-sign-in';
