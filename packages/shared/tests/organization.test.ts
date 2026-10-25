import { describe, expect, it } from 'vitest';

import {
  GRANTABLE_ORG_PERMISSIONS,
  ORG_PERMISSIONS,
  ORG_PRESET_PERMISSIONS,
  ORGANIZATION_MESSAGES,
  STAFF_PRESETS,
  PERMISSION_KEYS,
  acceptIssue,
  createOrganizationSchema,
  deleteAccountSchema,
  deletionResolution,
  invitationIsFor,
  invitationState,
  inviteMemberSchema,
  memberMay,
  membershipChangeIssue,
  needsSecondAdministrator,
  normaliseInviteTarget,
  permissionsFor,
  respondInvitationSchema,
  senderPresetAfter,
  updateMemberSchema,
  updateOrganizationSchema,
  type InvitationLike,
  type MemberLike,
} from '../src/index';

/**
 * TEAM ACCESS, THE PURE RULES (2026-10-27). docs/DECISIONS.md,
 * "Organisational profiles and team access". The routes ask these functions;
 * so do these tests, with no database.
 */

const admin = (id: string, status: MemberLike['status'] = 'active'): MemberLike => ({
  id,
  preset: 'administrator',
  permissions: [...ORG_PERMISSIONS],
  status,
});
const contributor = (id: string, permissions = ORG_PRESET_PERMISSIONS.contributor): MemberLike => ({
  id,
  preset: 'contributor',
  permissions: [...permissions],
  status: 'active',
});
const viewer = (id: string): MemberLike => ({
  id,
  preset: 'viewer',
  permissions: ['inbox.read'],
  status: 'active',
});

describe('presets and granular permissions', () => {
  it('an administrator always holds every permission, whatever is asked', () => {
    expect(permissionsFor('administrator')).toEqual([...ORG_PERMISSIONS]);
    expect(permissionsFor('administrator', ['inbox.read'])).toEqual([...ORG_PERMISSIONS]);
  });

  it('a contributor gets the preset by default, or a narrower or wider grantable set', () => {
    expect(permissionsFor('contributor')).toEqual([...ORG_PRESET_PERMISSIONS.contributor]);
    expect(permissionsFor('contributor', ['inbox.read'])).toEqual(['inbox.read']);
    expect(permissionsFor('contributor', ['profile.edit', 'inbox.read'])).toEqual([
      'profile.edit',
      'inbox.read',
    ]);
  });

  it('nobody but an administrator can be given team management', () => {
    expect(permissionsFor('contributor', ['team.manage'])).toBeNull();
    expect(permissionsFor('viewer', ['team.manage'])).toBeNull();
    expect(GRANTABLE_ORG_PERMISSIONS).not.toContain('team.manage');
  });

  it('a viewer reads only: no write permission can be attached', () => {
    expect(permissionsFor('viewer')).toEqual(['inbox.read']);
    expect(permissionsFor('viewer', ['inbox.reply'])).toBeNull();
    expect(permissionsFor('viewer', ['listings.manage'])).toBeNull();
    expect(permissionsFor('viewer', [])).toEqual([]);
  });

  it('returns the canonical order without repeats', () => {
    expect(permissionsFor('contributor', ['inbox.reply', 'inbox.read', 'inbox.read'])).toEqual([
      'inbox.read',
      'inbox.reply',
    ]);
  });

  it('memberMay asks the member row, and an ended member may do nothing', () => {
    const c = contributor('c', ['inbox.read']);
    expect(memberMay(c, 'inbox.read')).toBe(true);
    expect(memberMay(c, 'inbox.reply')).toBe(false);
    expect(memberMay(c, 'team.manage')).toBe(false);
    expect(memberMay(admin('a'), 'team.manage')).toBe(true);
    expect(memberMay(admin('a', 'revoked'), 'inbox.read')).toBe(false);
    expect(memberMay(null, 'inbox.read')).toBe(false);
    // A contributor row that somehow carried team.manage still cannot manage the team.
    expect(memberMay({ ...c, permissions: ['team.manage'] }, 'team.manage')).toBe(false);
  });

  it('organisational permissions are never staff permissions or presets', () => {
    for (const p of ORG_PERMISSIONS) {
      expect(PERMISSION_KEYS as readonly string[]).not.toContain(p);
    }
    expect(STAFF_PRESETS as readonly string[]).not.toContain('contributor');
    expect(STAFF_PRESETS as readonly string[]).not.toContain('viewer');
  });
});

describe('last-administrator protection', () => {
  it('the only administrator cannot leave, be revoked or step down', () => {
    const members = [admin('a'), contributor('c')];
    for (const change of ['leave', 'revoke', 'demote'] as const) {
      expect(membershipChangeIssue({ members, targetId: 'a', change })).toBe(
        'organization_last_admin',
      );
    }
  });

  it('with a second active administrator, either may go', () => {
    const members = [admin('a'), admin('b'), viewer('v')];
    expect(membershipChangeIssue({ members, targetId: 'a', change: 'leave' })).toBeNull();
    expect(membershipChangeIssue({ members, targetId: 'b', change: 'revoke' })).toBeNull();
  });

  it('a revoked administrator does not count as the second one', () => {
    const members = [admin('a'), admin('b', 'revoked')];
    expect(membershipChangeIssue({ members, targetId: 'a', change: 'leave' })).toBe(
      'organization_last_admin',
    );
  });

  it('a non-administrator may always go', () => {
    const members = [admin('a'), contributor('c')];
    expect(membershipChangeIssue({ members, targetId: 'c', change: 'revoke' })).toBeNull();
  });

  it('nudges for a second administrator while there is one', () => {
    expect(needsSecondAdministrator([admin('a'), contributor('c')])).toBe(true);
    expect(needsSecondAdministrator([admin('a'), admin('b')])).toBe(false);
  });
});

describe('invitations: authentication of the recipient', () => {
  const now = new Date('2026-10-27T10:00:00Z');
  const later = new Date('2026-11-03T10:00:00Z');
  const byPhone: InvitationLike = {
    kind: 'member',
    status: 'pending',
    channel: 'phone',
    target: '+211912345678',
    expiresAt: later,
  };
  const byEmail: InvitationLike = { ...byPhone, channel: 'email', target: 'ama@example.org' };
  const farmer = { authUserId: 'u1', phone: '+211912345678', email: null };
  const buyer = { authUserId: 'u2', phone: null, email: 'Ama@Example.org' };

  it('is for the account signed in as that phone or that email, and nobody else', () => {
    expect(invitationIsFor(byPhone, farmer)).toBe(true);
    expect(invitationIsFor(byPhone, buyer)).toBe(false);
    expect(invitationIsFor(byEmail, buyer)).toBe(true);
    expect(invitationIsFor(byEmail, farmer)).toBe(false);
  });

  it('accepts only pending, unexpired invitations, for the right account, once', () => {
    expect(acceptIssue({ invitation: byPhone, caller: farmer, now, alreadyMember: false })).toBe(
      null,
    );
    expect(acceptIssue({ invitation: byPhone, caller: buyer, now, alreadyMember: false })).toBe(
      'organization_invitation_other_account',
    );
    expect(
      acceptIssue({ invitation: byPhone, caller: farmer, now: later, alreadyMember: false }),
    ).toBe('organization_invitation_expired');
    expect(
      acceptIssue({
        invitation: { ...byPhone, status: 'cancelled' },
        caller: farmer,
        now,
        alreadyMember: false,
      }),
    ).toBe('organization_invitation_not_pending');
    expect(acceptIssue({ invitation: byPhone, caller: farmer, now, alreadyMember: true })).toBe(
      'organization_already_member',
    );
  });

  it('a handover is for the member it was offered to', () => {
    const transfer: InvitationLike = {
      kind: 'transfer',
      status: 'pending',
      channel: null,
      target: null,
      expiresAt: later,
      targetMemberAuthUserId: 'u2',
    };
    expect(acceptIssue({ invitation: transfer, caller: buyer, now, alreadyMember: true })).toBe(
      null,
    );
    expect(acceptIssue({ invitation: transfer, caller: farmer, now, alreadyMember: true })).toBe(
      'organization_invitation_other_account',
    );
  });

  it('reads a pending invitation past its date as expired', () => {
    expect(invitationState(byPhone, now)).toBe('pending');
    expect(invitationState(byPhone, later)).toBe('expired');
    expect(invitationState({ ...byPhone, status: 'accepted' }, later)).toBe('accepted');
  });

  it('normalises the phone or email it is sent to', () => {
    expect(normaliseInviteTarget('phone', '0912 345 678')).toEqual({
      ok: true,
      value: '+211912345678',
    });
    expect(normaliseInviteTarget('email', ' Ama@Example.ORG ')).toEqual({
      ok: true,
      value: 'ama@example.org',
    });
    expect(normaliseInviteTarget('phone', 'abc').ok).toBe(false);
    expect(normaliseInviteTarget('email', 'not-an-email').ok).toBe(false);
  });

  it('the schema refuses permissions the preset may not carry', () => {
    const bad = inviteMemberSchema.safeParse({
      channel: 'phone',
      target: '+211912345678',
      preset: 'viewer',
      permissions: ['inbox.reply'],
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe(ORGANIZATION_MESSAGES.permissionsNotForPreset);
    }
    const good = inviteMemberSchema.parse({
      channel: 'email',
      target: 'AMA@example.org',
      preset: 'contributor',
    });
    expect(good).toEqual({
      channel: 'email',
      target: 'ama@example.org',
      preset: 'contributor',
      permissions: [...ORG_PRESET_PERMISSIONS.contributor],
    });
  });

  it('answering names one invitation: a link token or an id', () => {
    const token = 'a'.repeat(43);
    expect(respondInvitationSchema.safeParse({ token, accept: true }).success).toBe(true);
    expect(
      respondInvitationSchema.safeParse({
        token,
        invitation_id: '00000000-0000-4000-8000-000000000000',
        accept: true,
      }).success,
    ).toBe(false);
    expect(respondInvitationSchema.safeParse({ accept: true }).success).toBe(false);
    expect(respondInvitationSchema.safeParse({ token: 'short', accept: true }).success).toBe(false);
  });
});

describe('handover and member changes', () => {
  it('the offering administrator becomes what they chose, or leaves', () => {
    expect(senderPresetAfter('administrator')).toBe('administrator');
    expect(senderPresetAfter('viewer')).toBe('viewer');
    expect(senderPresetAfter('leave')).toBeNull();
  });

  it('a member cannot be made administrator by a preset change', () => {
    expect(updateMemberSchema.safeParse({ preset: 'administrator' }).success).toBe(false);
    expect(updateMemberSchema.safeParse({ preset: 'viewer' }).success).toBe(true);
    expect(updateMemberSchema.safeParse({}).success).toBe(false);
  });
});

describe('personal deletion of a member', () => {
  it('leaves where someone else administers, and must close where they are the last', () => {
    const result = deletionResolution([
      { organizationId: 'o1', member: admin('a'), members: [admin('a'), contributor('c')] },
      { organizationId: 'o2', member: admin('a2'), members: [admin('a2'), admin('b')] },
      { organizationId: 'o3', member: contributor('c3'), members: [admin('x'), contributor('c3')] },
      { organizationId: 'o4', member: admin('a4', 'left'), members: [admin('a4', 'left')] },
    ]);
    expect(result).toEqual({ leave: ['o2', 'o3'], mustClose: ['o1'] });
  });

  it('the delete request may carry the choice to close those organisations', () => {
    expect(
      deleteAccountSchema.safeParse({ password: 'x', confirm: true, close_organizations: true })
        .success,
    ).toBe(true);
    expect(deleteAccountSchema.safeParse({ password: 'x', confirm: true }).success).toBe(true);
  });
});

describe('the organisation profile', () => {
  it('reuses the existing kinds: a group names its kind, nothing else does', () => {
    expect(
      createOrganizationSchema.safeParse({ name: 'Yei Farmers', profile_kind: 'group' }).success,
    ).toBe(false);
    expect(
      createOrganizationSchema.safeParse({
        name: 'Yei Farmers',
        profile_kind: 'group',
        group_kind: 'cooperative',
        activities: ['farmer'],
      }).success,
    ).toBe(true);
    expect(
      createOrganizationSchema.safeParse({ name: 'Juba College', profile_kind: 'individual' })
        .success,
    ).toBe(false);
  });

  it('a public phone is checked and stored as +211; blank means none', () => {
    const parsed = createOrganizationSchema.parse({
      name: 'Juba College',
      profile_kind: 'institution',
      public_phone: '0912345678',
      public_email: '',
    });
    expect(parsed.public_phone).toBe('+211912345678');
    expect(parsed.public_email).toBeNull();
    expect(parsed.activities).toEqual([]);
  });

  it('an edit must change something', () => {
    expect(updateOrganizationSchema.safeParse({}).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({ status: 'published' }).success).toBe(true);
  });
});
