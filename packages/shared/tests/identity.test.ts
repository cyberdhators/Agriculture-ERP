import { describe, expect, it } from 'vitest';

import {
  IDENTITY_MESSAGES,
  OFFICER_AUTH_DOMAIN,
  canWrite,
  createOfficerSchema,
  createUserSchema,
  officerAuthIdentifier,
} from '../src/index';

/** Every phone number and name here is FABRICATED. */

describe('the derived authentication identifier', () => {
  it('resolves every accepted written form of a number to the same account', () => {
    const written = [
      '0912345678',
      '+211912345678',
      '211912345678',
      '+211 91 234 5678',
      '+211-91-234-5678',
    ];
    const derived = written.map(officerAuthIdentifier);

    expect(new Set(derived).size, `these did not agree: ${JSON.stringify(derived)}`).toBe(1);
    expect(derived[0]).toBe(`officer.211912345678@${OFFICER_AUTH_DOMAIN}`);
  });

  it('carries no plus, so it cannot disagree with the form GoTrue stores', () => {
    // GoTrue strips the leading plus from a phone. The identifier never has one
    // to strip, which is the whole point of deriving it.
    expect(officerAuthIdentifier('+211912345678')).not.toContain('+');
  });

  it('gives different officers different identifiers', () => {
    expect(officerAuthIdentifier('+211912345678')).not.toBe(officerAuthIdentifier('+211987654321'));
  });

  it('uses a domain that can never receive mail', () => {
    // RFC 2606 reserves .invalid permanently, so no future owner can register it.
    expect(OFFICER_AUTH_DOMAIN.endsWith('.invalid')).toBe(true);
  });

  it('refuses to derive an identifier from a number the rest of the system rejects', () => {
    // Otherwise a code path that skipped validation could mint an identifier
    // for a malformed number, and two officers could collide.
    for (const bad of ['912345678', '+254712345678', 'not a number', '']) {
      expect(() => officerAuthIdentifier(bad), `should have thrown for ${bad}`).toThrow();
    }
  });

  it('is stable across calls', () => {
    expect(officerAuthIdentifier('0912345678')).toBe(officerAuthIdentifier('0912345678'));
  });
});

describe('who may write', () => {
  it.each([
    ['admin', true],
    ['supervisor', true],
    ['officer', true],
    ['read_only', false],
  ])('%s can write: %s', (role, expected) => {
    expect(canWrite(role as never)).toBe(expected);
  });
});

describe('creating an account', () => {
  const base = {
    name: 'Fabricated Staff',
    email: 'staff@example.invalid',
    password: 'a-long-enough-password',
  };

  it('an administrator must not be limited to one state', () => {
    const r = createUserSchema.safeParse({ ...base, role: 'admin', state_id: 'CE' });
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues[0]?.message).toBe(IDENTITY_MESSAGES.stateForbiddenForAdmin);
  });

  it('an administrator without a state is accepted', () => {
    expect(createUserSchema.safeParse({ ...base, role: 'admin' }).success).toBe(true);
  });

  it.each(['supervisor', 'read_only'])('a %s must be given a state', (role) => {
    const r = createUserSchema.safeParse({ ...base, role });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe(IDENTITY_MESSAGES.stateRequiredForRole);
  });

  it.each(['supervisor', 'read_only'])('a %s with a state is accepted', (role) => {
    expect(createUserSchema.safeParse({ ...base, role, state_id: 'CE' }).success).toBe(true);
  });

  it('refuses a password too short to resist guessing', () => {
    expect(createUserSchema.safeParse({ ...base, password: 'short', role: 'admin' }).success).toBe(
      false,
    );
  });

  it('an officer is created with a phone, normalised to E.164', () => {
    const r = createOfficerSchema.safeParse({
      name: 'Fabricated Officer',
      phone: '0912345678',
      password: 'a-long-enough-password',
      payam_id: 'CE-JUB-MUN',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phone).toBe('+211912345678');
  });

  it('refuses a field the request should not carry', () => {
    expect(createUserSchema.safeParse({ ...base, role: 'admin', is_admin: true }).success).toBe(
      false,
    );
  });
});
