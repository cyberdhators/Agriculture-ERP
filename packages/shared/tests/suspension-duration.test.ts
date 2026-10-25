import { describe, expect, it } from 'vitest';

import {
  SUSPENSION_MESSAGES,
  accountSuspendSchema,
  suspensionEndDate,
  suspensionEndsAt,
  suspensionHasEnded,
} from '../src';

/**
 * A SUSPENSION MAY END BY ITSELF (2026-10-29, CORWADO's Settings line
 * "reason codes, suspension duration and appeals").
 */

const base = {
  kind: 'farmer',
  id: '7f6c1b0e-2a4d-4c1e-9b8a-3d2f1e0c9b8a',
  reason: 'Repeated fake listings',
};

describe('accountSuspendSchema', () => {
  it('accepts no duration (no end), null, and whole days from 1 to 365', () => {
    expect(accountSuspendSchema.safeParse(base).success).toBe(true);
    expect(accountSuspendSchema.safeParse({ ...base, suspend_days: null }).success).toBe(true);
    for (const days of [1, 7, 365]) {
      expect(accountSuspendSchema.safeParse({ ...base, suspend_days: days }).success).toBe(true);
    }
  });

  it('refuses 0, 366, a fraction and text, with the pinned reason', () => {
    for (const days of [0, 366, 2.5, '7', -1]) {
      const r = accountSuspendSchema.safeParse({ ...base, suspend_days: days });
      expect(r.success, String(days)).toBe(false);
      expect(r.error?.issues[0]?.message).toBe(SUSPENSION_MESSAGES.daysInvalid);
    }
  });

  it('still refuses a field it does not know', () => {
    expect(accountSuspendSchema.safeParse({ ...base, until: '2026-12-01' }).success).toBe(false);
  });
});

describe('suspensionEndsAt', () => {
  it('ends at midnight in Juba (22:00 UTC the day before) after N full days', () => {
    // 5 November 2026, 14:00 in Juba.
    const end = suspensionEndsAt(new Date('2026-11-05T12:00:00Z'), 7);
    expect(end?.toISOString()).toBe('2026-11-12T22:00:00.000Z');
    expect(suspensionEndDate(end as Date)).toBe('2026-11-13');
  });

  it("counts from Juba's date, not UTC's, late in the evening", () => {
    // 23:30 UTC on 5 November is already 01:30 on 6 November in Juba.
    const end = suspensionEndsAt(new Date('2026-11-05T23:30:00Z'), 1);
    expect(suspensionEndDate(end as Date)).toBe('2026-11-08');
  });

  it('has no end without a number of days', () => {
    expect(suspensionEndsAt(new Date(), null)).toBeNull();
    expect(suspensionEndsAt(new Date(), undefined)).toBeNull();
  });
});

describe('suspensionHasEnded', () => {
  const now = new Date('2026-11-12T06:00:00Z');
  const past = new Date('2026-11-11T22:00:00Z');
  const future = new Date('2026-11-13T22:00:00Z');
  const suspendedAt = new Date('2026-11-05T12:00:00Z');

  it('is true for a suspension whose end has passed', () => {
    expect(suspensionHasEnded({ suspendedAt, disabledAt: null, suspensionEnds: past }, now)).toBe(
      true,
    );
  });

  it('is false before the end, with no end, when disabled, or when not suspended', () => {
    expect(suspensionHasEnded({ suspendedAt, disabledAt: null, suspensionEnds: future }, now)).toBe(
      false,
    );
    expect(suspensionHasEnded({ suspendedAt, disabledAt: null, suspensionEnds: null }, now)).toBe(
      false,
    );
    expect(
      suspensionHasEnded({ suspendedAt, disabledAt: suspendedAt, suspensionEnds: past }, now),
    ).toBe(false);
    expect(
      suspensionHasEnded({ suspendedAt: null, disabledAt: null, suspensionEnds: past }, now),
    ).toBe(false);
  });
});
