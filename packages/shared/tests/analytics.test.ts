import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ANALYTICS_LIMITATIONS,
  ANALYTICS_MAX_DAYS,
  ANALYTICS_MESSAGES,
  ANALYTICS_METRICS,
  METRIC_GROUPS,
  analyticsExportSchema,
  analyticsFilterSchema,
  jubaToday,
  resolveAnalyticsWindow,
} from '../src/index';

/**
 * Analytics (2026-10-22). DEFINITIONS FIRST: no figure without the sentence
 * that says what it counts, over what, from where and in which window.
 */

describe('the metric definitions', () => {
  it('lists figures in every group', () => {
    for (const group of METRIC_GROUPS) {
      expect(
        ANALYTICS_METRICS.some((m) => m.group === group),
        `${group} has no figure`,
      ).toBe(true);
    }
  });

  it('gives every figure a unique id', () => {
    const ids = ANALYTICS_METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every figure a label, a definition, a denominator, a source and a window', () => {
    for (const m of ANALYTICS_METRICS) {
      expect(m.label.trim(), `${m.id}: label`).not.toBe('');
      expect(m.definition.trim().length, `${m.id}: definition`).toBeGreaterThan(20);
      expect(m.definition.trim(), `${m.id}: definition is a sentence`).toMatch(/\.$/);
      expect(m.denominator.trim(), `${m.id}: denominator`).not.toBe('');
      expect(m.source.trim(), `${m.id}: source`).not.toBe('');
      expect(m.window.trim(), `${m.id}: window`).not.toBe('');
    }
  });

  it('names a unit for every figure, so people, accounts and profiles are never mixed', () => {
    const units = new Set(ANALYTICS_METRICS.map((m) => m.unit));
    expect(units).toContain('people');
    expect(units).toContain('accounts');
    expect(units).toContain('profiles');
  });

  it('says how a state filter applies, or that the figure is national only', () => {
    for (const m of ANALYTICS_METRICS) {
      expect(m.stateRule === null || m.stateRule.trim() !== '', m.id).toBe(true);
    }
    expect(ANALYTICS_METRICS.filter((m) => m.stateRule === null).map((m) => m.id)).toEqual([
      'onboarding.phones_started',
      'onboarding.phones_confirmed',
      'support.received',
      // 2026-10-25: advice cases and profiles carry no state of their own.
      'advice.providers_published',
      'advice.approved_advisers',
      'advice.requests',
      'advice.cases_closed',
      'advice.median_days_to_close',
      'advice.feedback_given',
      'advice.average_rating',
      'advice.applications_submitted',
      'advice.applications_decided',
      'advice.referrals',
      'system.failures',
    ]);
  });

  it('keeps buying requests, messages, orders and completed trades as separate figures', () => {
    const ids = ANALYTICS_METRICS.map((m) => m.id);
    for (const id of [
      'buying_requests.created',
      'purchase_requests.sent',
      'messages.conversations',
      'messages.sent',
      'inquiries.contact_requests',
      'orders.created',
      'trades.orders_delivered',
      'trades.sales_recorded',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('says so wherever a breakdown overlaps', () => {
    const activities = ANALYTICS_METRICS.find((m) => m.id === 'participation.activities');
    expect(activities?.breakdown?.overlapping).toBe(true);
    expect(activities?.definition).toMatch(/overlap/);
  });

  it('reads the verified-only view for verified farmers and counts the rest apart', () => {
    const verified = ANALYTICS_METRICS.find((m) => m.id === 'farmers.verified');
    expect(verified?.source).toContain('farmer_verified_v');
    expect(ANALYTICS_METRICS.map((m) => m.id)).toEqual(
      expect.arrayContaining(['farmers.rejected', 'farmers.pending_now']),
    );
  });

  // Replaced 2026-10-25, not removed: "no advice table yet" became "advice
  // tables only in the Advice group", now that advice is measured.
  it('references advice tables only from the Advice group', () => {
    for (const m of ANALYTICS_METRICS) {
      if (m.group === 'advice') continue;
      expect(JSON.stringify(m), m.id).not.toMatch(/advice_|adviser_|advisory_/);
    }
    expect(ANALYTICS_METRICS.filter((m) => m.group === 'advice').length).toBe(10);
  });

  it('states its limitations', () => {
    expect(ANALYTICS_LIMITATIONS.length).toBeGreaterThan(3);
    const text = ANALYTICS_LIMITATIONS.join(' ');
    expect(text).toMatch(/Advice figures are national only/);
    expect(text).not.toMatch(/Advice usage and case outcomes are not measured/);
  });
});

describe('the filter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const reason = (input: unknown, field: string) => {
    const r = analyticsFilterSchema.safeParse(input);
    expect(r.success).toBe(false);
    return r.error?.issues.find((i) => i.path[0] === field)?.message;
  };

  it('accepts nothing at all: the last 30 days', () => {
    expect(analyticsFilterSchema.parse({})).toEqual({});
  });

  it('accepts a window and a state', () => {
    expect(
      analyticsFilterSchema.parse({ from: '2026-01-01', to: '2026-01-31', state_id: 'CE' }),
    ).toEqual({ from: '2026-01-01', to: '2026-01-31', state_id: 'CE' });
  });

  it('refuses a date that is not YYYY-MM-DD or not a real day', () => {
    expect(reason({ from: '01/02/2026' }, 'from')).toBe(ANALYTICS_MESSAGES.dateInvalid);
    expect(reason({ from: '2026-02-30' }, 'from')).toBe(ANALYTICS_MESSAGES.dateInvalid);
    expect(reason({ to: 20260101 }, 'to')).toBe(ANALYTICS_MESSAGES.dateInvalid);
  });

  it('refuses a window that ends after today in Juba', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T10:00:00Z'));
    expect(reason({ to: '2026-10-23' }, 'to')).toBe(ANALYTICS_MESSAGES.dateFuture);
    expect(analyticsFilterSchema.safeParse({ to: '2026-10-22' }).success).toBe(true);
  });

  it('refuses a reversed window', () => {
    expect(reason({ from: '2026-03-02', to: '2026-03-01' }, 'to')).toBe(
      ANALYTICS_MESSAGES.windowReversed,
    );
  });

  it(`refuses a window longer than ${ANALYTICS_MAX_DAYS} days and allows exactly that`, () => {
    expect(analyticsFilterSchema.safeParse({ from: '2024-01-01', to: '2024-12-31' }).success).toBe(
      true,
    );
    expect(reason({ from: '2024-01-01', to: '2025-01-01' }, 'from')).toBe(
      ANALYTICS_MESSAGES.windowTooLong,
    );
  });

  it('refuses an unknown field and a malformed state', () => {
    expect(analyticsFilterSchema.safeParse({ season: '2026-main' }).success).toBe(false);
    expect(reason({ state_id: 'CE; DROP' }, 'state_id')).toBe(ANALYTICS_MESSAGES.stateInvalid);
  });

  it('takes the same filters inside an export request', () => {
    expect(
      analyticsExportSchema.parse({ filters: { from: '2026-01-01', to: '2026-01-02' } }),
    ).toEqual({ filters: { from: '2026-01-01', to: '2026-01-02' } });
    expect(analyticsExportSchema.safeParse({ filters: { from: 'x' } }).success).toBe(false);
  });
});

describe('the window', () => {
  it('reads today in Juba, not in UTC', () => {
    // 23:30 UTC on 21 October is 01:30 on 22 October in Juba (UTC+2).
    expect(jubaToday(new Date('2026-10-21T23:30:00Z'))).toBe('2026-10-22');
  });

  it('defaults to the last 30 Juba days, today included', () => {
    const w = resolveAnalyticsWindow({}, new Date('2026-10-21T23:30:00Z'));
    expect(w.to).toBe('2026-10-22');
    expect(w.from).toBe('2026-09-23');
    expect(w.days).toBe(30);
  });

  it('starts and ends at Juba midnight, the last day included', () => {
    const w = resolveAnalyticsWindow({ from: '2026-10-01', to: '2026-10-01' });
    expect(w.days).toBe(1);
    expect(w.startsAt.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(w.endsAt.toISOString()).toBe('2026-10-01T22:00:00.000Z');
  });
});
