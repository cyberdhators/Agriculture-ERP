import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_MESSAGES,
  MATCH_ALERT_METRICS,
  MATCH_ALERT_REPORT_MESSAGES,
  MATCH_ALERT_SOURCES,
  buildMatchAlertFunnel,
  matchAlertReportFilterSchema,
  periodStartOf,
  ratePercent,
  ratesOf,
  type MatchAlertDayRow,
} from '../src';

/** The funnel logic of the match-alert results report (2026-11-03). Pure. */

const row = (over: Partial<MatchAlertDayRow> = {}): MatchAlertDayRow => ({
  day: '2026-10-05',
  source: 'listing_match',
  sent: 0,
  in_app: 0,
  sms: 0,
  read: 0,
  conversations: 0,
  conversation_due: 0,
  conversation_due_hit: 0,
  deals: 0,
  deal_due: 0,
  deal_due_hit: 0,
  ...over,
});

const WINDOW = { from: '2026-10-01', to: '2026-10-30', days: 30 };

describe('rates', () => {
  it('is a percent with one decimal, and null (not 0) with no denominator', () => {
    expect(ratePercent(1, 3)).toBe(33.3);
    expect(ratePercent(2, 2)).toBe(100);
    expect(ratePercent(0, 5)).toBe(0);
    expect(ratePercent(0, 0)).toBeNull();
  });

  it('each rate has its own denominator', () => {
    const r = ratesOf({
      ...row(),
      sent: 10,
      in_app: 8,
      read: 4,
      conversations: 3,
      conversation_due: 5,
      conversation_due_hit: 2,
      deals: 1,
      deal_due: 0,
      deal_due_hit: 0,
    });
    // Opened of in-app (not of all sent); conversations of matured alerts only.
    expect(r).toEqual({ read_rate: 50, conversation_rate: 40, deal_rate: null });
  });
});

describe('periods', () => {
  it('a day is itself; a week starts on Monday; a month on the 1st', () => {
    expect(periodStartOf('2026-10-07', 'day')).toBe('2026-10-07');
    // 2026-10-07 is a Wednesday; its week starts Monday 2026-10-05.
    expect(periodStartOf('2026-10-07', 'week')).toBe('2026-10-05');
    expect(periodStartOf('2026-10-05', 'week')).toBe('2026-10-05');
    expect(periodStartOf('2026-10-11', 'week')).toBe('2026-10-05');
    expect(periodStartOf('2026-10-31', 'month')).toBe('2026-10-01');
  });
});

describe('the funnel from day rows', () => {
  const rows = [
    row({ day: '2026-10-02', source: 'listing_match', sent: 4, in_app: 4, read: 2, conversations: 1, conversation_due: 4, conversation_due_hit: 1, deals: 1, deal_due: 4, deal_due_hit: 1 }),
    row({ day: '2026-10-02', source: 'saved_search', sent: 2, in_app: 2, sms: 1, read: 2, conversations: 2, conversation_due: 2, conversation_due_hit: 2 }),
    row({ day: '2026-10-20', source: 'buying_request_match', sent: 3, in_app: 3, read: 0 }),
  ];
  const f = buildMatchAlertFunnel(rows, WINDOW);

  it('totals add every row', () => {
    expect(f.totals).toMatchObject({ sent: 9, in_app: 9, sms: 1, read: 4, conversations: 3, deals: 1 });
    expect(f.totals?.read_rate).toBe(44.4);
    expect(f.totals?.conversation_rate).toBe(50);
    expect(f.totals?.deal_rate).toBe(25);
  });

  it('one line per source, every source, in a fixed order, adding up to the totals', () => {
    expect(f.by_source.map((l) => l.source)).toEqual([...MATCH_ALERT_SOURCES]);
    expect(f.by_source.reduce((n, l) => n + l.sent, 0)).toBe(f.totals?.sent);
    const saved = f.by_source.find((l) => l.source === 'saved_search')!;
    expect(saved).toMatchObject({ sent: 2, sms: 1, conversation_rate: 100, deal_rate: null });
    expect(saved.label).toBe('Saved search');
  });

  it('the trend has a point for every period, zeros included', () => {
    expect(f.trend.bucket).toBe('day');
    expect(f.trend.periods).toHaveLength(30);
    expect(f.trend.sent[1]).toBe(6);
    expect(f.trend.sent[19]).toBe(3);
    expect(f.trend.conversations[1]).toBe(3);
    expect(f.trend.deals[1]).toBe(1);
    expect(f.trend.sent.reduce((a, b) => a + b, 0)).toBe(9);
  });

  it('a longer window is drawn by week', () => {
    const w = buildMatchAlertFunnel(rows, { from: '2026-07-01', to: '2026-10-30', days: 122 });
    expect(w.trend.bucket).toBe('week');
    expect(w.trend.sent.reduce((a, b) => a + b, 0)).toBe(9);
  });

  it('ignores a row outside the window or of an unknown source rather than miscount it', () => {
    const g = buildMatchAlertFunnel(
      [
        row({ day: '2026-09-30', sent: 5 }),
        row({ source: 'elsewhere' as MatchAlertDayRow['source'], sent: 7 }),
      ],
      WINDOW,
    );
    expect(g.totals?.sent).toBe(0);
  });

  it('nothing sent: counts are 0 and every rate is null', () => {
    const g = buildMatchAlertFunnel([], WINDOW);
    expect(g.totals).toMatchObject({ sent: 0, read_rate: null, conversation_rate: null, deal_rate: null });
  });
});

describe('the report filters', () => {
  it('accepts the analytics window and state, a product word and a source', () => {
    const r = matchAlertReportFilterSchema.parse({
      from: '2026-10-01',
      to: '2026-10-10',
      state_id: 'ST-1',
      commodity: 'crop',
      product: ' sorghum ',
      source: 'saved_search',
    });
    expect(r).toEqual({
      from: '2026-10-01',
      to: '2026-10-10',
      state_id: 'ST-1',
      commodity: 'crop',
      product: 'sorghum',
      source: 'saved_search',
    });
  });

  it('refuses with the analytics page’s own sentences for the window', () => {
    const r = matchAlertReportFilterSchema.safeParse({ from: '2026-10-10', to: '2026-10-01' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(ANALYTICS_MESSAGES.windowReversed);
    const c = matchAlertReportFilterSchema.safeParse({ commodity: 'gold' });
    expect(c.error?.issues[0]?.message).toBe(ANALYTICS_MESSAGES.commodityInvalid);
  });

  it('refuses an unknown source and unknown fields', () => {
    const r = matchAlertReportFilterSchema.safeParse({ source: 'other' });
    expect(r.error?.issues[0]?.message).toBe(MATCH_ALERT_REPORT_MESSAGES.sourceUnknown);
    expect(matchAlertReportFilterSchema.safeParse({ actor_type: 'farmer' }).success).toBe(false);
  });
});

describe('every figure is defined', () => {
  it('with a definition, a denominator, a source and a window', () => {
    for (const d of MATCH_ALERT_METRICS) {
      expect(d.definition.length, d.id).toBeGreaterThan(20);
      expect(d.denominator.length, d.id).toBeGreaterThan(3);
      expect(d.source.length, d.id).toBeGreaterThan(3);
      expect(d.window.length, d.id).toBeGreaterThan(3);
    }
    expect(MATCH_ALERT_METRICS.map((d) => d.id)).toEqual([
      'sent',
      'in_app',
      'sms',
      'read',
      'conversations',
      'deals',
    ]);
  });
});
