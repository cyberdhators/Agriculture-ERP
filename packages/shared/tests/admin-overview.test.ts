import { describe, expect, it } from 'vitest';

import {
  ADMIN_OVERVIEW_MESSAGES,
  ANALYTICS_MESSAGES,
  adminOverviewFilterSchema,
  daysOf,
  fillDays,
  fillMarketDays,
  jubaToday,
  overviewAlerts,
  overviewHref,
  presetRange,
} from '../src/index';

describe('the overview filter', () => {
  it('accepts nothing at all, and an actor type from the profile activities', () => {
    expect(adminOverviewFilterSchema.parse({})).toEqual({});
    expect(adminOverviewFilterSchema.parse({ actor: 'processor', state_id: 'CE' })).toEqual({
      actor: 'processor',
      state_id: 'CE',
    });
  });

  it('refuses an unknown actor type with its own message', () => {
    const r = adminOverviewFilterSchema.safeParse({ actor: 'pirate' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(ADMIN_OVERVIEW_MESSAGES.actorUnknown);
  });

  it('applies the analytics window rules and messages', () => {
    const reversed = adminOverviewFilterSchema.safeParse({ from: '2026-10-10', to: '2026-10-01' });
    expect(reversed.error?.issues[0]?.message).toBe(ANALYTICS_MESSAGES.windowReversed);
    const bad = adminOverviewFilterSchema.safeParse({ from: '2026-02-30' });
    expect(bad.error?.issues[0]?.message).toBe(ANALYTICS_MESSAGES.dateInvalid);
    const state = adminOverviewFilterSchema.safeParse({ state_id: 'no spaces' });
    expect(state.error?.issues[0]?.message).toBe(ANALYTICS_MESSAGES.stateInvalid);
  });

  it('refuses a field it does not know', () => {
    expect(adminOverviewFilterSchema.safeParse({ cursor: 'x' }).success).toBe(false);
  });
});

describe('the day series', () => {
  it('lists every day of the window, both ends included, across a month end', () => {
    expect(daysOf('2026-09-29', '2026-10-02')).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
    expect(daysOf('2026-10-02', '2026-10-01')).toEqual([]);
  });

  it('fills a missing day with 0, adds duplicates, and drops days outside the window', () => {
    expect(
      fillDays('2026-10-01', '2026-10-03', [
        { day: '2026-10-03', value: 2 },
        { day: '2026-10-03', value: 1 },
        { day: '2026-09-30', value: 9 },
      ]),
    ).toEqual([
      { date: '2026-10-01', value: 0 },
      { date: '2026-10-02', value: 0 },
      { date: '2026-10-03', value: 3 },
    ]);
  });

  it('keeps the two market series on the same days', () => {
    expect(
      fillMarketDays('2026-10-01', '2026-10-02', [
        { day: '2026-10-02', listings: 4, buying_requests: 1 },
      ]),
    ).toEqual([
      { date: '2026-10-01', listings: 0, buying_requests: 0 },
      { date: '2026-10-02', listings: 4, buying_requests: 1 },
    ]);
  });

  it('gives the last N days ending today', () => {
    expect(presetRange(7, '2026-10-28')).toEqual({ from: '2026-10-22', to: '2026-10-28' });
    expect(presetRange(1, '2026-10-28')).toEqual({ from: '2026-10-28', to: '2026-10-28' });
    expect(presetRange(30, jubaToday()).to).toBe(jubaToday());
  });
});

describe('figures link to the list behind them, filters carried', () => {
  const filter = {
    from: '2026-10-01',
    to: '2026-10-28',
    state_id: 'CE',
    actor: 'trader' as const,
  };

  it('carries location and actor to the accounts list, but not the window to a stock figure', () => {
    expect(overviewHref('accounts', filter)).toBe(
      '/admin/accounts?sign_in=yes&state=CE&actor=trader',
    );
    expect(overviewHref('new_accounts', filter)).toBe(
      '/admin/accounts?from=2026-10-01&to=2026-10-28&state=CE&actor=trader',
    );
  });

  it('opens the marketplace console on the right tab', () => {
    expect(overviewHref('active_buying_requests', filter)).toBe(
      '/admin/marketplace?tab=buying_requests&state=CE&actor=trader',
    );
  });

  it('opens the case queues without filters they do not offer', () => {
    expect(overviewHref('appeals', filter)).toBe('/admin/support?status=open&case_type=appeal');
    expect(overviewHref('product_reports', filter)).toBe('/product-reports');
    expect(overviewHref('adviser_applications', {})).toBe('/admin/advisers');
  });

  it('opens analytics with the window and location, never the actor', () => {
    expect(overviewHref('registrations', filter)).toBe(
      '/analytics?from=2026-10-01&to=2026-10-28&state=CE',
    );
  });
});

describe('system alerts', () => {
  const none = { integrations: null, failures: null, maintenance: null, missingTables: [] };

  it('says nothing when nothing is wrong', () => {
    expect(
      overviewAlerts({
        ...none,
        integrations: [{ name: 'Bird', purpose: 'SMS', configured: true, variables: ['A'] }],
        failures: { 'communication.send_failed': 0 },
        maintenance: { enabled: false, message: '' },
      }),
    ).toEqual([]);
  });

  it('names an integration that is not configured, but not one that reads no setting', () => {
    const alerts = overviewAlerts({
      ...none,
      integrations: [
        { name: 'Resend', purpose: 'Email', configured: false, variables: ['A'] },
        { name: 'Mapbox', purpose: 'Maps', configured: false, variables: [] },
      ],
    });
    expect(alerts.map((a) => a.id)).toEqual(['integration:Resend']);
    expect(alerts[0]?.title).toBe('Resend is not configured');
    expect(alerts[0]?.level).toBe('warn');
  });

  it('puts failures first, then warnings, then notes, with counts', () => {
    const alerts = overviewAlerts({
      integrations: [{ name: 'Bird', purpose: 'SMS', configured: false, variables: ['A'] }],
      failures: { suspension_sms_failed: 2, 'something.else_failed': 1 },
      maintenance: { enabled: true, message: 'Down at noon' },
      missingTables: ['organization'],
    });
    expect(alerts.map((a) => a.level)).toEqual(['error', 'error', 'warn', 'info', 'info']);
    expect(alerts[0]?.title).toContain(': 2');
    expect(alerts[1]?.href).toBe('/admin/audit');
    expect(alerts.find((a) => a.id === 'maintenance')?.body).toBe('Down at noon');
  });

  it('names no integration to a caller who may not see settings', () => {
    expect(overviewAlerts({ ...none, integrations: null })).toEqual([]);
  });
});
