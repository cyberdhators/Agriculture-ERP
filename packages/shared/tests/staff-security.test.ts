import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_TOUCH_INTERVAL_MS,
  SIGN_IN_LIMITS,
  STAFF_INVITATION_TTL_MS,
  acceptStaffInvitationSchema,
  aalOfToken,
  maskInviteEmail,
  shouldTouchActivity,
  signInRateDecision,
  signInRequestSchema,
  staffInvitationSchema,
  staffInvitationStatus,
  staffMfaGate,
  staffMfaMode,
  staffMfaStatus,
} from '../src';

/** A token-shaped string whose payload is `claims`. Not signed: aalOfToken reads, never verifies. */
const tokenWith = (claims: Record<string, unknown>): string =>
  `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;

describe('the enforcement mode', () => {
  it('reads the three modes and treats anything else as the safe default, never as off', () => {
    expect(staffMfaMode('off')).toBe('off');
    expect(staffMfaMode('REQUIRED')).toBe('required');
    expect(staffMfaMode(' verify ')).toBe('verify');
    expect(staffMfaMode(undefined)).toBe('verify');
    expect(staffMfaMode('')).toBe('verify');
    expect(staffMfaMode('disabled')).toBe('verify');
  });
});

describe('the two-step gate', () => {
  const admin = { role: 'admin', hasVerifiedFactor: false, aal: 'aal1' as const };
  const enrolledAal1 = { role: 'supervisor', hasVerifiedFactor: true, aal: 'aal1' as const };
  const enrolledAal2 = { role: 'admin', hasVerifiedFactor: true, aal: 'aal2' as const };

  it('an account with an authenticator must have passed the code step, in verify and required', () => {
    expect(staffMfaGate(enrolledAal1, 'verify', false)).toBe('verify_required');
    expect(staffMfaGate(enrolledAal1, 'required', false)).toBe('verify_required');
    expect(staffMfaGate({ ...enrolledAal1, aal: null }, 'verify', false)).toBe('verify_required');
    expect(staffMfaGate(enrolledAal2, 'verify', false)).toBe('ok');
  });

  it('THE ROLLOUT: verify never refuses an administrator who has not enrolled; required does', () => {
    expect(staffMfaGate(admin, 'verify', false)).toBe('ok');
    expect(staffMfaGate(admin, 'required', false)).toBe('enrolment_required');
  });

  it('required asks enrolment of administrators only', () => {
    expect(staffMfaGate({ ...admin, role: 'supervisor' }, 'required', false)).toBe('ok');
    expect(staffMfaGate({ ...admin, role: 'read_only' }, 'required', false)).toBe('ok');
  });

  it('the exempt routes and the off switch let every session through', () => {
    expect(staffMfaGate(enrolledAal1, 'verify', true)).toBe('ok');
    expect(staffMfaGate(admin, 'required', true)).toBe('ok');
    expect(staffMfaGate(enrolledAal1, 'off', false)).toBe('ok');
    expect(staffMfaGate(admin, 'off', false)).toBe('ok');
  });

  it('the portal is told to send an administrator to enrol even in verify mode', () => {
    expect(staffMfaStatus(admin, 'verify')).toMatchObject({ enrol_now: true, verify_now: false });
    expect(staffMfaStatus({ ...admin, role: 'supervisor' }, 'verify').enrol_now).toBe(false);
    expect(staffMfaStatus(enrolledAal1, 'verify')).toMatchObject({
      enrolled: true,
      session_verified: false,
      verify_now: true,
      enrol_now: false,
    });
    expect(staffMfaStatus(enrolledAal2, 'required')).toMatchObject({
      verify_now: false,
      enrol_now: false,
    });
    expect(staffMfaStatus(admin, 'off')).toMatchObject({ verify_now: false, enrol_now: false });
  });
});

describe('the aal claim', () => {
  it('reads aal1 and aal2 from a token payload, and null from anything else', () => {
    expect(aalOfToken(tokenWith({ aal: 'aal2' }))).toBe('aal2');
    expect(aalOfToken(tokenWith({ aal: 'aal1' }))).toBe('aal1');
    expect(aalOfToken(tokenWith({ aal: 'aal3' }))).toBeNull();
    expect(aalOfToken(tokenWith({}))).toBeNull();
    expect(aalOfToken('not-a-token')).toBeNull();
    expect(aalOfToken('a.%%%.b')).toBeNull();
    expect(aalOfToken(null)).toBeNull();
  });
});

describe('the sign-in rate rule', () => {
  const now = 10_000_000;
  const fail = (agoMs: number) => ({ atMs: now - agoMs, succeeded: false });

  it('allows four failures in the window and refuses the fifth onwards, saying how long', () => {
    const four = [1, 2, 3, 4].map((m) => fail(m * 60_000));
    expect(signInRateDecision({ attempts: four, nowMs: now })).toEqual({ allowed: true });
    const five = [...four, fail(5 * 60_000)];
    const refused = signInRateDecision({ attempts: five, nowMs: now });
    expect(refused.allowed).toBe(false);
    // The oldest of the five leaves the window ten minutes from now.
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBe(10 * 60);
  });

  it('failures outside the window do not count', () => {
    const old = [1, 2, 3, 4, 5].map(() => fail(SIGN_IN_LIMITS.windowMs + 1));
    expect(signInRateDecision({ attempts: old, nowMs: now }).allowed).toBe(true);
  });

  it('a success clears the failures before it', () => {
    const attempts = [
      ...[6, 7, 8, 9, 10].map((m) => fail(m * 60_000)),
      { atMs: now - 5 * 60_000, succeeded: true },
      fail(60_000),
    ];
    expect(signInRateDecision({ attempts, nowMs: now }).allowed).toBe(true);
  });

  it('lower-cases the identifier and never accepts an empty password', () => {
    expect(signInRequestSchema.parse({ identifier: ' Staff@Example.ORG ', password: 'x' })).toEqual(
      {
        identifier: 'staff@example.org',
        password: 'x',
      },
    );
    expect(signInRequestSchema.safeParse({ identifier: 'a@b.c', password: '' }).success).toBe(
      false,
    );
    expect(
      signInRequestSchema.safeParse({ identifier: 'a@b.c', password: 'x', extra: 1 }).success,
    ).toBe(false);
  });
});

describe('last activity is throttled', () => {
  it('touches the first time and then once per interval', () => {
    expect(shouldTouchActivity(undefined, 1)).toBe(true);
    expect(shouldTouchActivity(1000, 1000 + ACTIVITY_TOUCH_INTERVAL_MS - 1)).toBe(false);
    expect(shouldTouchActivity(1000, 1000 + ACTIVITY_TOUCH_INTERVAL_MS)).toBe(true);
  });
});

describe('staff invitations', () => {
  it('needs a state for a state-scoped role and refuses one for an administrator', () => {
    expect(
      staffInvitationSchema.safeParse({ name: 'A', email: 'a@b.org', role: 'supervisor' }).success,
    ).toBe(false);
    expect(
      staffInvitationSchema.safeParse({
        name: 'A',
        email: 'a@b.org',
        role: 'admin',
        state_id: 'CE',
      }).success,
    ).toBe(false);
    const ok = staffInvitationSchema.parse({
      name: 'A',
      email: ' A@B.org ',
      role: 'read_only',
      state_id: 'CE',
    });
    expect(ok.email).toBe('a@b.org');
  });

  it('accepts only a 43-character token and a password of at least 12', () => {
    const token = 'a'.repeat(43);
    expect(
      acceptStaffInvitationSchema.safeParse({ token, password: 'long-enough-1' }).success,
    ).toBe(true);
    expect(acceptStaffInvitationSchema.safeParse({ token, password: 'short' }).success).toBe(false);
    expect(
      acceptStaffInvitationSchema.safeParse({ token: 'a'.repeat(42), password: 'long-enough-1' })
        .success,
    ).toBe(false);
  });

  it('reads the status from the row and the clock', () => {
    const now = Date.now();
    const base = { accepted_at: null, revoked_at: null };
    expect(staffInvitationStatus({ ...base, expires_at: new Date(now + 1000) }, now)).toBe(
      'pending',
    );
    expect(staffInvitationStatus({ ...base, expires_at: new Date(now) }, now)).toBe('expired');
    expect(
      staffInvitationStatus(
        { accepted_at: new Date(), revoked_at: null, expires_at: new Date(now - 1) },
        now,
      ),
    ).toBe('accepted');
    expect(
      staffInvitationStatus(
        { accepted_at: null, revoked_at: new Date(), expires_at: new Date(now + 1) },
        now,
      ),
    ).toBe('revoked');
    expect(STAFF_INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('masks an address down to its first character and its domain', () => {
    expect(maskInviteEmail('amina@corwado.org')).toBe('a•••@corwado.org');
    expect(maskInviteEmail('nope')).toBe('•••');
  });
});
