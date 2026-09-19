import { describe, expect, it } from 'vitest';

import {
  DEACTIVATION_WARNING,
  ROLE_LABELS,
  ROLE_SCOPE_HELP,
  STAFF_ROLES,
  canRemoveAccount,
  canSetPasswordFor,
  deactivationOutcome,
  describeRoleChange,
  roleNeedsState,
  scopeLabel,
} from './account-rules';

describe('roles and scope', () => {
  it('offers exactly the three staff roles the backend enum defines', () => {
    expect([...STAFF_ROLES]).toEqual(['admin', 'supervisor', 'read_only']);
  });

  it('does not treat extension officer as a staff account role', () => {
    // An officer is a separate principal kind with its own table and its own
    // routes, not a fourth value in the staff role enum.
    expect(STAFF_ROLES).not.toContain('officer');
    expect(Object.keys(ROLE_LABELS)).not.toContain('officer');
  });

  it('requires a state for supervisor and read-only, and forbids one for admin', () => {
    expect(roleNeedsState('supervisor')).toBe(true);
    expect(roleNeedsState('read_only')).toBe(true);
    expect(roleNeedsState('admin')).toBe(false);
  });

  it('reads an administrator as national and never as a missing state', () => {
    expect(scopeLabel('admin', null)).toBe('National · all states');
    expect(scopeLabel('admin', 'Central Equatoria')).toBe('National · all states');
  });

  it('says plainly when a state-bound role has no state yet', () => {
    expect(scopeLabel('supervisor', null)).toBe('State required');
    expect(scopeLabel('supervisor', 'Central Equatoria')).toBe('Central Equatoria');
  });

  it('explains every role’s scope in words', () => {
    for (const role of STAFF_ROLES) {
      expect(ROLE_SCOPE_HELP[role].length).toBeGreaterThan(0);
    }
    expect(ROLE_SCOPE_HELP.read_only).toMatch(/cannot modify/i);
  });
});

describe('the change summary shown before a role change', () => {
  it('spells out a promotion from one state to the whole country', () => {
    const change = describeRoleChange(
      { role: 'supervisor', stateName: 'Central Equatoria' },
      { role: 'admin', stateName: null },
    );
    expect(change.roleChanged).toBe(true);
    expect(change.scopeChanged).toBe(true);
    expect(change.from).toEqual({ role: 'Supervisor', scope: 'Central Equatoria' });
    expect(change.to).toEqual({ role: 'Administrator', scope: 'National · all states' });
  });

  it('notices a role change that leaves the scope alone', () => {
    const change = describeRoleChange(
      { role: 'supervisor', stateName: 'Central Equatoria' },
      { role: 'read_only', stateName: 'Central Equatoria' },
    );
    expect(change.roleChanged).toBe(true);
    expect(change.scopeChanged).toBe(false);
  });

  it('reports no change when nothing changed', () => {
    const change = describeRoleChange(
      { role: 'admin', stateName: null },
      { role: 'admin', stateName: null },
    );
    expect(change.roleChanged).toBe(false);
    expect(change.scopeChanged).toBe(false);
  });
});

describe('an administrator cannot act on their own account', () => {
  it('offers no Remove against yourself', () => {
    expect(canRemoveAccount({ viewerId: 'me', targetId: 'me' })).toBe(false);
    expect(canRemoveAccount({ viewerId: 'me', targetId: 'someone' })).toBe(true);
  });

  it('offers no Set password against yourself', () => {
    expect(canSetPasswordFor({ viewerId: 'me', targetId: 'me' })).toBe(false);
    expect(canSetPasswordFor({ viewerId: 'me', targetId: 'someone' })).toBe(true);
  });

  it('offers neither while the viewer is unknown, failing closed', () => {
    // Until /api/me has answered we cannot tell whose account this is. Hiding
    // wrongly costs a refresh; showing wrongly offers an action the server
    // will refuse, which teaches the reader the screen is unreliable.
    expect(canRemoveAccount({ viewerId: null, targetId: 'anyone' })).toBe(false);
    expect(canSetPasswordFor({ viewerId: null, targetId: 'anyone' })).toBe(false);
  });
});

describe('officer deactivation reports the server’s number and never its own', () => {
  it('uses the exact count the server returned', () => {
    expect(deactivationOutcome('Zztest Officer', 12)).toBe(
      'Zztest Officer deactivated. 12 farmers are now without a working officer.',
    );
  });

  it('says none were assigned when the server actually counted zero', () => {
    expect(deactivationOutcome('Zztest Officer', 0)).toContain('No farmers were assigned');
  });

  it('agrees with itself about one farmer', () => {
    expect(deactivationOutcome('Zztest Officer', 1)).toContain('1 farmer is now without');
  });

  it('never prints a zero when the server sent no number at all', () => {
    // The distinction this whole module exists for: unmeasured is not zero.
    const outcome = deactivationOutcome('Zztest Officer', undefined);
    expect(outcome).toContain('was not reported');
    expect(outcome).not.toMatch(/\b0\b/);
    expect(outcome).not.toMatch(/no farmers were assigned/i);
  });

  it('warns before the change without inventing a figure', () => {
    // No route offers a preflight count; the number exists only in the
    // response to the deactivation itself.
    expect(DEACTIVATION_WARNING).toMatch(/may become orphaned/i);
    expect(DEACTIVATION_WARNING).not.toMatch(/\d/);
  });
});

describe('no administrator count is invented anywhere', () => {
  it('exposes no helper that claims to know whether this is the last admin', () => {
    // The users list pages by cursor and reports no total, so a client cannot
    // know. The last-admin rule is the server's, enforced under a row lock.
    const exported = {
      canRemoveAccount,
      canSetPasswordFor,
      deactivationOutcome,
      describeRoleChange,
      roleNeedsState,
      scopeLabel,
    };
    for (const name of Object.keys(exported)) {
      expect(name).not.toMatch(/lastAdmin|adminCount|countAdmins/i);
    }
  });
});
