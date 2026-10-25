import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTIONS,
  ORGANIZATION_VERIFY_PERMISSION,
  ORG_PERMISSIONS,
  PERMISSION_KEYS,
  PRESET_PERMISSIONS,
  STAFF_PRESETS,
  buyerOrganizationVerified,
  effectivePermissions,
  mayVerifyOrganizations,
  orgVerificationAuditAction,
  orgVerificationDecision,
  organizationVerificationSchema,
} from '../src';

/**
 * ONLY ORGANISATIONS ARE VERIFIED (2026-10-31). The owner: "remove
 * verification from accounts. only organization needs to be verified by
 * admin and superadmin not individual." docs/DECISIONS.md.
 */

const platform = { kind: 'platform' } as const;
const held = (role: string, ...presets: (typeof STAFF_PRESETS)[number][]) =>
  effectivePermissions({ role, grants: presets.map((preset) => ({ preset, scope: platform })) });

describe('who may verify an organisation', () => {
  it('is a staff permission key, held by Administrator and Super Admin and no other preset', () => {
    expect(PERMISSION_KEYS).toContain(ORGANIZATION_VERIFY_PERMISSION);
    const holders = STAFF_PRESETS.filter((p) =>
      PRESET_PERMISSIONS[p].includes(ORGANIZATION_VERIFY_PERMISSION),
    );
    expect([...holders].sort()).toEqual(['administrator', 'super_admin']);
  });

  it('an administrator with the Administrator or Super Admin preset may verify', () => {
    expect(mayVerifyOrganizations(held('admin', 'administrator'))).toBe(true);
    expect(mayVerifyOrganizations(held('admin', 'super_admin'))).toBe(true);
  });

  it('Moderator + Editor, Support, Analyst and a bare role may not', () => {
    for (const preset of ['moderator_editor', 'support', 'analyst'] as const) {
      expect(mayVerifyOrganizations(held('admin', preset)), preset).toBe(false);
    }
    expect(mayVerifyOrganizations(held('admin'))).toBe(false);
  });

  it('a farmer, buyer or officer never holds it, whatever grant is passed', () => {
    for (const role of ['farmer', 'buyer', 'officer']) {
      expect(mayVerifyOrganizations(held(role, 'super_admin')), role).toBe(false);
    }
  });

  it('an organisation’s own team permissions cannot award it', () => {
    expect(ORG_PERMISSIONS as readonly string[]).not.toContain(ORGANIZATION_VERIFY_PERMISSION);
  });
});

describe('the decision', () => {
  it('verifies an unverified organisation, and removes the mark from a verified one', () => {
    expect(orgVerificationDecision({ current: 'unverified', closed: false, verified: true })).toEqual(
      { allowed: true, to: 'verified' },
    );
    expect(orgVerificationDecision({ current: 'verified', closed: false, verified: false })).toEqual(
      { allowed: true, to: 'unverified' },
    );
  });

  it('refuses a decision that changes nothing', () => {
    expect(orgVerificationDecision({ current: 'verified', closed: false, verified: true })).toEqual(
      { allowed: false, reason: 'transition_not_allowed' },
    );
  });

  it('refuses a closed organisation either way', () => {
    for (const verified of [true, false]) {
      expect(
        orgVerificationDecision({ current: 'unverified', closed: true, verified }),
      ).toEqual({ allowed: false, reason: 'organization_closed' });
    }
  });

  it('writes its own audit key, and both keys are registered', () => {
    expect(orgVerificationAuditAction('verified')).toBe('organization.verified');
    expect(orgVerificationAuditAction('unverified')).toBe('organization.verification_removed');
    expect(AUDIT_ACTIONS).toContain('organization.verified');
    expect(AUDIT_ACTIONS).toContain('organization.verification_removed');
  });
});

describe('the body', () => {
  it('verifying needs no note; removing the mark needs a reason', () => {
    expect(organizationVerificationSchema.safeParse({ verified: true }).success).toBe(true);
    expect(organizationVerificationSchema.safeParse({ verified: false }).success).toBe(false);
    expect(
      organizationVerificationSchema.safeParse({ verified: false, note: 'Registration lapsed' })
        .success,
    ).toBe(true);
  });

  it('is strict: no status, id or actor can be sent', () => {
    expect(
      organizationVerificationSchema.safeParse({ verified: true, verified_by: 'x' }).success,
    ).toBe(false);
  });
});

describe('a person is never a verified anything', () => {
  it('an individual buyer account never carries the badge, whatever an old row says', () => {
    expect(buyerOrganizationVerified('individual', 'verified')).toBe(false);
    expect(buyerOrganizationVerified('business', 'verified')).toBe(true);
    expect(buyerOrganizationVerified('business', 'pending')).toBe(false);
    expect(buyerOrganizationVerified(null, null)).toBe(false);
  });
});
