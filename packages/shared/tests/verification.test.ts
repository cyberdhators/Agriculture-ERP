import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  REJECTION_REASONS,
  VERIFICATION_MESSAGES,
  VERIFICATION_STATES,
  VERIFICATION_TRANSITIONS,
  auditSafe,
  canTransition,
  daysWaiting,
  isEscalated,
  mergeFarmerSchema,
  rejectFarmerSchema,
  scrubEvent,
  zodErrorToApiError,
} from '../src/index';

describe('the transition table (C-6.1), both directions', () => {
  const allowed = new Set(
    Object.entries(VERIFICATION_TRANSITIONS).flatMap(([from, tos]) =>
      tos.map((to) => `${from}->${to}`),
    ),
  );
  it('allows exactly the transitions the data model names', () => {
    expect([...allowed].sort()).toEqual(
      [
        'pending->merged',
        'pending->rejected',
        'pending->verified',
        'rejected->merged',
        'rejected->pending',
        'verified->merged',
      ].sort(),
    );
  });
  for (const from of VERIFICATION_STATES) {
    for (const to of VERIFICATION_STATES) {
      const key = `${from}->${to}`;
      it(`${key}: ${allowed.has(key) ? 'allowed' : 'refused'}`, () => {
        expect(canTransition(from, to)).toBe(allowed.has(key));
      });
    }
  }
});

describe('the rejection input (C-6.3)', () => {
  it('accepts a code with an optional note, and a body without a code — the route answers that as 422', () => {
    expect(
      rejectFarmerSchema.safeParse({ reason_code: 'incomplete', note: 'consent form unreadable' })
        .success,
    ).toBe(true);
    expect(rejectFarmerSchema.safeParse({}).success).toBe(true);
  });
  it('refuses a code outside the list, naming the field', () => {
    const r = rejectFarmerSchema.safeParse({ reason_code: 'lazy' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(zodErrorToApiError(r.error).body.error.fields?.reason_code).toBe(
        VERIFICATION_MESSAGES.reasonInvalid,
      );
    }
  });
  it('refuses a note over 280 characters, and one with control characters', () => {
    expect(
      rejectFarmerSchema.safeParse({ reason_code: 'other', note: 'x'.repeat(281) }).success,
    ).toBe(false);
    expect(
      rejectFarmerSchema.safeParse({ reason_code: 'other', note: 'line one\nline two' }).success,
    ).toBe(false);
  });
  it('the reason list is the six the section names', () => {
    expect([...REJECTION_REASONS]).toEqual([
      'duplicate',
      'wrong_location',
      'incomplete',
      'not_a_farmer',
      'consent_missing',
      'other',
    ]);
  });
  it('a merge names its target', () => {
    expect(mergeFarmerSchema.safeParse({}).success).toBe(false);
    expect(
      mergeFarmerSchema.safeParse({ target_id: '11111111-2222-4333-8444-555555555555' }).success,
    ).toBe(true);
  });
});

describe('the note never leaves through the audit log or error reporting (C-6.3)', () => {
  it("an event carrying a note leaves without it, in B1.5's shape", () => {
    const out = scrubEvent({
      message: 'rejection failed',
      extra: { note: 'Zzachol told the officer she has two plots', reason_code: 'other' },
      breadcrumbs: [{ data: { note: 'another note about a person' } }],
    }) as {
      extra: { note: string; reason_code: string };
      breadcrumbs: { data: { note: string } }[];
    };
    expect(out.extra.note).toBe(REDACTED);
    expect(out.breadcrumbs[0]?.data.note).toBe(REDACTED);
    expect(out.extra.reason_code).toBe('other');
  });
  it('the audit log records the reason code and drops the note', () => {
    const safe = auditSafe({
      verification_status: 'rejected',
      reason_code: 'incomplete',
      note: 'prose about a person',
    });
    expect(safe).toEqual({ verification_status: 'rejected', reason_code: 'incomplete' });
  });
});

describe('the clock (C-6.7)', () => {
  it('counts whole days, floors, never negative, escalates strictly after seven', () => {
    const now = new Date('2026-09-10T12:00:00Z');
    expect(daysWaiting(new Date('2026-09-03T13:00:00Z'), now)).toBe(6);
    expect(daysWaiting(new Date('2026-09-03T11:00:00Z'), now)).toBe(7);
    expect(daysWaiting(new Date('2026-09-11T00:00:00Z'), now)).toBe(0);
    expect(isEscalated(7)).toBe(false);
    expect(isEscalated(8)).toBe(true);
  });
});
