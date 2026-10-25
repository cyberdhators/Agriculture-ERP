import { describe, expect, it } from 'vitest';

import {
  ORDINARY_PRESETS,
  PERMISSION_KEYS,
  PRESET_PERMISSIONS,
  RETURN_SESSION_INACTIVITY_MS,
  ROLLOUT_PRESETS_FOR_ADMINS_WITHOUT_GRANTS,
  STAFF_PRESETS,
  classifyVisit,
  covers,
  deviceLabel,
  effectivePermissions,
  grantPresetSchema,
  holdsPermission,
  isSuperAdmin,
  mayLoseSuperAdmin,
  superAdminGrantDecision,
  superAdminGrantSchema,
} from '../src/index';

/**
 * Staff permissions, Super Admin delegation and access logs (2026-10-19).
 * Pure: every function here takes values and returns values. The routes that
 * use them load rows and ask these; the rules are proved here, not there.
 */

const platform = { kind: 'platform' } as const;
const states = (...ids: string[]) => ({ kind: 'states', stateIds: ids }) as const;

describe('presets', () => {
  it('Super Admin carries every key', () => {
    expect([...PRESET_PERMISSIONS.super_admin].sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it('only Super Admin reaches appointing Super Admins or identifiable exports', () => {
    for (const preset of ORDINARY_PRESETS) {
      expect(PRESET_PERMISSIONS[preset]).not.toContain('superadmin.grant');
      expect(PRESET_PERMISSIONS[preset]).not.toContain('exports.identifiable');
    }
  });

  it('platform-wide moderation or editing never implies Super Admin, staff, settings or sensitive exports', () => {
    const p = effectivePermissions({
      role: 'supervisor',
      grants: [{ preset: 'moderator_editor', scope: platform }],
    });
    expect(holdsPermission(p, 'content.moderate')).toBe(true);
    expect(holdsPermission(p, 'content.publish')).toBe(true);
    for (const key of [
      'superadmin.grant',
      'exports.identifiable',
      'staff.manage',
      'settings.manage',
    ] as const) {
      expect(holdsPermission(p, key), key).toBe(false);
    }
    expect(isSuperAdmin(p)).toBe(false);
  });

  it('every preset is described and has at least one key', () => {
    for (const preset of STAFF_PRESETS)
      expect(PRESET_PERMISSIONS[preset].length).toBeGreaterThan(0);
  });
});

describe('effective permissions', () => {
  it('an administrator with no grant holds NO permission (2026-10-30: presets are binding)', () => {
    const p = effectivePermissions({ role: 'admin', grants: [] });
    expect(p.size).toBe(0);
    for (const key of PERMISSION_KEYS) expect(holdsPermission(p, key), key).toBe(false);
    expect(isSuperAdmin(p)).toBe(false);
  });

  it('a supervisor or read-only account with no grant holds nothing', () => {
    expect(effectivePermissions({ role: 'supervisor', grants: [] }).size).toBe(0);
    expect(effectivePermissions({ role: 'read_only', grants: [] }).size).toBe(0);
  });

  it('officers, buyers and farmers hold nothing, whatever is passed', () => {
    for (const role of ['officer', 'buyer', 'farmer']) {
      expect(
        effectivePermissions({ role, grants: [{ preset: 'super_admin', scope: platform }] }).size,
      ).toBe(0);
    }
  });

  it('a Super Admin grant counts only on an administrator account', () => {
    const admin = effectivePermissions({
      role: 'admin',
      grants: [{ preset: 'super_admin', scope: platform }],
    });
    expect(isSuperAdmin(admin)).toBe(true);
    const demoted = effectivePermissions({
      role: 'supervisor',
      grants: [{ preset: 'super_admin', scope: platform }],
    });
    expect(isSuperAdmin(demoted)).toBe(false);
    expect(demoted.size).toBe(0);
  });

  it('a state grant reaches its states and nothing else', () => {
    const p = effectivePermissions({
      role: 'supervisor',
      grants: [{ preset: 'administrator', scope: states('CE', 'WE') }],
    });
    expect(holdsPermission(p, 'staff.manage', states('CE'))).toBe(true);
    expect(holdsPermission(p, 'staff.manage', states('CE', 'WE'))).toBe(true);
    expect(holdsPermission(p, 'staff.manage', states('CE', 'JG'))).toBe(false);
    expect(holdsPermission(p, 'staff.manage')).toBe(false);
  });

  it('several presets combine, and a platform grant swallows a state grant of the same key', () => {
    const p = effectivePermissions({
      role: 'read_only',
      grants: [
        { preset: 'analyst', scope: states('CE') },
        { preset: 'administrator', scope: platform },
        { preset: 'support', scope: states('WE') },
      ],
    });
    expect(holdsPermission(p, 'reports.view')).toBe(true);
    expect(holdsPermission(p, 'support.handle', states('WE'))).toBe(true);
    expect(holdsPermission(p, 'support.handle', states('CE'))).toBe(false);
  });

  it('an empty states request is refused, never read as "anywhere"', () => {
    expect(covers({ platform: false, states: new Set(['CE']) }, states())).toBe(false);
    expect(covers(undefined, platform)).toBe(false);
  });
});

describe('preset resolution: the role alone grants nothing (2026-10-30)', () => {
  const held = (role: string, preset: (typeof STAFF_PRESETS)[number]) =>
    [...effectivePermissions({ role, grants: [{ preset, scope: platform }] }).keys()].sort();

  it('an administrator with Moderator + Editor holds moderation and publishing only', () => {
    expect(held('admin', 'moderator_editor')).toEqual(['content.moderate', 'content.publish']);
  });

  it('an administrator with Support holds support only', () => {
    expect(held('admin', 'support')).toEqual(['support.handle']);
  });

  it('an Analyst holds analytics (reports.view) only, on any staff role', () => {
    for (const role of ['admin', 'supervisor', 'read_only']) {
      expect(held(role, 'analyst'), role).toEqual(['reports.view']);
    }
  });

  it('the Administrator preset holds the administrative powers and never Super Admin or sensitive exports', () => {
    const keys = held('admin', 'administrator');
    expect(keys).toEqual(
      [
        'audit.view',
        'communications.send',
        'reports.view',
        'settings.manage',
        'staff.manage',
      ].sort(),
    );
    expect(keys).not.toContain('superadmin.grant');
    expect(keys).not.toContain('exports.identifiable');
    expect(keys).not.toContain('content.moderate');
    expect(keys).not.toContain('support.handle');
  });

  it('Super Admin holds every key', () => {
    expect(held('admin', 'super_admin')).toEqual([...PERMISSION_KEYS].sort());
  });

  it('combined presets are the union of their keys', () => {
    const p = effectivePermissions({
      role: 'admin',
      grants: [
        { preset: 'moderator_editor', scope: platform },
        { preset: 'support', scope: platform },
      ],
    });
    expect([...p.keys()].sort()).toEqual(
      ['content.moderate', 'content.publish', 'support.handle'].sort(),
    );
  });

  it('the rollout presets give an administrator exactly what the old legacy rule did, less identifiable exports', () => {
    const p = effectivePermissions({
      role: 'admin',
      grants: ROLLOUT_PRESETS_FOR_ADMINS_WITHOUT_GRANTS.map((preset) => ({
        preset,
        scope: platform,
      })),
    });
    const legacy = PERMISSION_KEYS.filter(
      (k) => k !== 'superadmin.grant' && k !== 'exports.identifiable',
    );
    expect([...p.keys()].sort()).toEqual([...legacy].sort());
    for (const key of legacy) expect(holdsPermission(p, key), key).toBe(true);
    expect(isSuperAdmin(p)).toBe(false);
  });
});

describe('Super Admin delegation', () => {
  const base = {
    granterId: 'a',
    granterRole: 'admin',
    granterIsSuperAdmin: false,
    targetId: 'a',
    targetRole: 'admin',
    activeSuperAdminIds: [] as string[],
  };

  it('bootstrap: with no Super Admin, an administrator may appoint themselves', () => {
    expect(superAdminGrantDecision(base)).toEqual({ allowed: true, bootstrap: true });
  });

  it('bootstrap is for oneself only', () => {
    expect(superAdminGrantDecision({ ...base, targetId: 'b' })).toEqual({
      allowed: false,
      reason: 'not_super_admin',
    });
  });

  it('bootstrap ends once a Super Admin exists', () => {
    expect(superAdminGrantDecision({ ...base, activeSuperAdminIds: ['z'] })).toEqual({
      allowed: false,
      reason: 'not_super_admin',
    });
  });

  it('a supervisor cannot bootstrap', () => {
    expect(superAdminGrantDecision({ ...base, granterRole: 'supervisor' }).allowed).toBe(false);
  });

  it('a Super Admin may appoint another administrator', () => {
    expect(
      superAdminGrantDecision({
        ...base,
        granterIsSuperAdmin: true,
        targetId: 'b',
        activeSuperAdminIds: ['a'],
      }),
    ).toEqual({ allowed: true, bootstrap: false });
  });

  it('only an administrator account can become a Super Admin', () => {
    expect(
      superAdminGrantDecision({
        ...base,
        granterIsSuperAdmin: true,
        targetId: 'b',
        targetRole: 'supervisor',
      }),
    ).toEqual({ allowed: false, reason: 'target_not_admin' });
  });

  it('an existing Super Admin is not appointed twice', () => {
    expect(
      superAdminGrantDecision({
        ...base,
        granterIsSuperAdmin: true,
        targetId: 'b',
        activeSuperAdminIds: ['a', 'b'],
      }),
    ).toEqual({ allowed: false, reason: 'already_super_admin' });
  });

  it('requires re-authentication and an explicit confirmation in the request', () => {
    const ok = {
      user_id: '00000000-0000-4000-8000-000000000001',
      reason: 'Second Super Admin for cover.',
      password: 'x',
      confirm: true,
    };
    expect(superAdminGrantSchema.safeParse(ok).success).toBe(true);
    expect(superAdminGrantSchema.safeParse({ ...ok, confirm: false }).success).toBe(false);
    expect(superAdminGrantSchema.safeParse({ ...ok, password: undefined }).success).toBe(false);
    expect(superAdminGrantSchema.safeParse({ ...ok, password: '' }).success).toBe(false);
    expect(superAdminGrantSchema.safeParse({ ...ok, totp_code: '12ab56' }).success).toBe(false);
    expect(superAdminGrantSchema.safeParse({ ...ok, totp_code: '123456' }).success).toBe(true);
  });
});

describe('the last Super Admin is protected', () => {
  it('the only active Super Admin cannot be revoked, removed or demoted', () => {
    expect(mayLoseSuperAdmin(['a'], 'a')).toBe(false);
  });

  it('one of two may go', () => {
    expect(mayLoseSuperAdmin(['a', 'b'], 'a')).toBe(true);
  });

  it('someone who is not a Super Admin is not protected by this rule', () => {
    expect(mayLoseSuperAdmin(['a'], 'c')).toBe(true);
    expect(mayLoseSuperAdmin([], 'c')).toBe(true);
  });
});

describe('grant requests', () => {
  const ok = {
    user_id: '00000000-0000-4000-8000-000000000001',
    preset: 'analyst',
    scope: 'states',
    state_ids: ['CE'],
    reason: 'Covers the Central Equatoria reports.',
  };

  it('accepts a states grant with states, and a platform grant without', () => {
    expect(grantPresetSchema.safeParse(ok).success).toBe(true);
    expect(
      grantPresetSchema.safeParse({ ...ok, scope: 'platform', state_ids: undefined }).success,
    ).toBe(true);
  });

  it('refuses a states grant with no states, and a platform grant with some', () => {
    expect(grantPresetSchema.safeParse({ ...ok, state_ids: [] }).success).toBe(false);
    expect(grantPresetSchema.safeParse({ ...ok, scope: 'platform' }).success).toBe(false);
  });

  it('refuses Super Admin: it has its own route, with re-authentication', () => {
    expect(grantPresetSchema.safeParse({ ...ok, preset: 'super_admin' }).success).toBe(false);
  });

  it('requires a reason', () => {
    expect(grantPresetSchema.safeParse({ ...ok, reason: '  ' }).success).toBe(false);
  });
});

describe('return-session classification', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it('the inactivity threshold is thirty minutes', () => {
    expect(RETURN_SESSION_INACTIVITY_MS).toBe(30 * 60 * 1000);
  });

  it('the first visit ever recorded is the first sign-in', () => {
    expect(
      classifyVisit({ firstSignInAt: null, lastSeenAt: null, now, signInAnnounced: false }),
    ).toBe('first_sign_in');
    expect(
      classifyVisit({ firstSignInAt: null, lastSeenAt: minutesAgo(1), now, signInAnnounced: true }),
    ).toBe('first_sign_in');
  });

  it('a visit the sign-in screen announced is a sign-in', () => {
    expect(
      classifyVisit({
        firstSignInAt: minutesAgo(600),
        lastSeenAt: minutesAgo(1),
        now,
        signInAnnounced: true,
      }),
    ).toBe('sign_in');
  });

  it('more than thirty minutes idle, then a visit, is a return session', () => {
    expect(
      classifyVisit({
        firstSignInAt: minutesAgo(600),
        lastSeenAt: minutesAgo(31),
        now,
        signInAnnounced: false,
      }),
    ).toBe('return_session');
  });

  it('exactly thirty minutes is not yet a return session', () => {
    expect(
      classifyVisit({
        firstSignInAt: minutesAgo(600),
        lastSeenAt: minutesAgo(30),
        now,
        signInAnnounced: false,
      }),
    ).toBeNull();
  });

  it('ordinary activity writes no event', () => {
    expect(
      classifyVisit({
        firstSignInAt: minutesAgo(600),
        lastSeenAt: minutesAgo(2),
        now,
        signInAnnounced: false,
      }),
    ).toBeNull();
  });
});

describe('device label', () => {
  it('keeps only the platform family', () => {
    expect(
      deviceLabel('Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 Chrome/120'),
    ).toBe('android');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac');
    expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
    expect(deviceLabel('curl/8.0')).toBe('other');
    expect(deviceLabel(null)).toBeNull();
  });
});
