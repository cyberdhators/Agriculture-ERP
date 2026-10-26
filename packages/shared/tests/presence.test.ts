import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PREFERENCES,
  PRESENCE_BYE_THROTTLE_MS,
  PRESENCE_TICK_FAST_MS,
  PRESENCE_TICK_SLOW_MS,
  activeLabel,
  activeLabelText,
  counterpartVisible,
  lastSeenOf,
  presenceTickMs,
  shouldRecordBye,
  type PresenceFacts,
} from '../src';

const both = (over: Partial<PresenceFacts> = {}): PresenceFacts => ({
  viewerSignedIn: true,
  viewerShows: true,
  counterpart: 'person',
  counterpartShows: true,
  ...over,
});

describe('who may see the other side’s activity', () => {
  it('two people who both show it see each other', () => {
    expect(counterpartVisible(both())).toBe(true);
  });

  it('is reciprocal: hiding yours hides everyone else’s from you', () => {
    expect(counterpartVisible(both({ viewerShows: false }))).toBe(false);
  });

  it('a person who hides theirs is hidden', () => {
    expect(counterpartVisible(both({ counterpartShows: false }))).toBe(false);
  });

  it('an organisation’s team is never shown to the outside party', () => {
    expect(counterpartVisible(both({ counterpart: 'organization' }))).toBe(false);
  });

  it('staff never appear online', () => {
    expect(counterpartVisible(both({ counterpart: 'staff' }))).toBe(false);
  });

  it('nobody without a session sees anything', () => {
    expect(counterpartVisible(both({ viewerSignedIn: false }))).toBe(false);
  });

  it('is on by default for every account, existing or new', () => {
    expect(DEFAULT_PREFERENCES.show_activity).toBe(true);
    expect(DEFAULT_PREFERENCES.match_in_app).toBe(true);
    expect(DEFAULT_PREFERENCES.match_sms).toBe(false);
  });
});

describe('coarse relative time, in Juba', () => {
  // 2026-10-26 12:00 in Juba (UTC+2) is 10:00 UTC.
  const NOW = Date.parse('2026-10-26T10:00:00Z');
  const at = (iso: string) => ({ online: false, last_active_at: iso });

  it('online wins', () => {
    expect(activeLabel({ online: true, last_active_at: null }, NOW)).toEqual({ kind: 'online' });
  });

  it('under five minutes is "just now"', () => {
    expect(activeLabel(at('2026-10-26T09:57:00Z'), NOW)).toEqual({ kind: 'just_now' });
  });

  it('minutes, then hours, while still today in Juba', () => {
    expect(activeLabel(at('2026-10-26T09:50:00Z'), NOW)).toEqual({ kind: 'minutes', n: 10 });
    expect(activeLabel(at('2026-10-26T08:00:00Z'), NOW)).toEqual({ kind: 'hours', n: 2 });
  });

  it('"yesterday" is by Juba’s calendar, not UTC’s', () => {
    // 21:30 UTC on the 25th is 23:30 in Juba on the 25th: yesterday.
    expect(activeLabel(at('2026-10-25T21:30:00Z'), NOW)).toEqual({ kind: 'yesterday' });
    // 22:30 UTC on the 25th is 00:30 in Juba on the 26th: today, hours ago.
    expect(activeLabel(at('2026-10-25T22:30:00Z'), NOW)).toEqual({ kind: 'hours', n: 11 });
  });

  it('days up to a week, then "over a week"', () => {
    expect(activeLabel(at('2026-10-23T10:00:00Z'), NOW)).toEqual({ kind: 'days', n: 3 });
    expect(activeLabel(at('2026-10-10T10:00:00Z'), NOW)).toEqual({ kind: 'weeks' });
  });

  it('nothing known is nothing shown', () => {
    expect(activeLabel(null, NOW)).toEqual({ kind: 'unknown' });
    expect(activeLabel({ online: false, last_active_at: null }, NOW)).toEqual({ kind: 'unknown' });
    expect(activeLabelText({ kind: 'unknown' }, 'en')).toBeNull();
  });

  it('reads in English and Arabic', () => {
    expect(activeLabelText({ kind: 'online' }, 'en')).toBe('Online');
    expect(activeLabelText({ kind: 'minutes', n: 5 }, 'en')).toBe('Active 5 minutes ago');
    expect(activeLabelText({ kind: 'hours', n: 1 }, 'en')).toBe('Active 1 hour ago');
    expect(activeLabelText({ kind: 'yesterday' }, 'en')).toBe('Active yesterday');
    expect(activeLabelText({ kind: 'days', n: 3 }, 'en')).toBe('Active 3 days ago');
    for (const label of [
      { kind: 'online' },
      { kind: 'just_now' },
      { kind: 'minutes', n: 5 },
      { kind: 'hours', n: 2 },
      { kind: 'yesterday' },
      { kind: 'days', n: 3 },
      { kind: 'weeks' },
    ] as const) {
      expect(activeLabelText(label, 'ar'), label.kind).toMatch(/[؀-ۿ]/);
    }
  });
});

describe('exact last seen, and a label that ticks (2026-11-01)', () => {
  const at = (iso: string) => new Date(iso);

  it('prefers the exact last-seen time over the five-minute activity stamp', () => {
    expect(
      lastSeenOf({
        presenceSeenAt: at('2026-11-01T10:03:10Z'),
        activitySeenAt: at('2026-11-01T10:00:00Z'),
      }),
    ).toEqual({ at: at('2026-11-01T10:03:10Z'), exact: true });
  });

  it('takes the activity stamp when it is newer than the last bye (active again since)', () => {
    expect(
      lastSeenOf({
        presenceSeenAt: at('2026-11-01T09:00:00Z'),
        activitySeenAt: at('2026-11-01T10:00:00Z'),
      }),
    ).toEqual({ at: at('2026-11-01T10:00:00Z'), exact: false });
  });

  it('uses whichever exists, and nothing when neither does', () => {
    expect(
      lastSeenOf({ presenceSeenAt: null, activitySeenAt: at('2026-11-01T10:00:00Z') }),
    ).toEqual({ at: at('2026-11-01T10:00:00Z'), exact: false });
    expect(
      lastSeenOf({ presenceSeenAt: at('2026-11-01T10:00:00Z'), activitySeenAt: null }),
    ).toEqual({ at: at('2026-11-01T10:00:00Z'), exact: true });
    expect(lastSeenOf({ presenceSeenAt: null, activitySeenAt: undefined })).toBeNull();
  });

  it('an exact time is "just now" for under a minute only; a coarse one for five', () => {
    const now = Date.parse('2026-11-01T10:02:30Z');
    const seen = '2026-11-01T10:00:00Z';
    expect(activeLabel({ online: false, last_active_at: seen, exact: true }, now)).toEqual({
      kind: 'minutes',
      n: 2,
    });
    expect(activeLabel({ online: false, last_active_at: seen, exact: false }, now)).toEqual({
      kind: 'just_now',
    });
    expect(activeLabel({ online: false, last_active_at: seen }, now)).toEqual({ kind: 'just_now' });
    expect(
      activeLabel({ online: false, last_active_at: seen, exact: true }, Date.parse(seen) + 59_000),
    ).toEqual({ kind: 'just_now' });
  });

  it('online wins over any last-seen time', () => {
    expect(
      activeLabel({ online: true, last_active_at: '2026-11-01T09:00:00Z', exact: true }, 0),
    ).toEqual({ kind: 'online' });
  });

  it('ticks every 30 s in minutes, every minute after, and not for online or nothing', () => {
    expect(presenceTickMs({ kind: 'just_now' })).toBe(PRESENCE_TICK_FAST_MS);
    expect(presenceTickMs({ kind: 'minutes', n: 3 })).toBe(PRESENCE_TICK_FAST_MS);
    expect(presenceTickMs({ kind: 'hours', n: 2 })).toBe(PRESENCE_TICK_SLOW_MS);
    expect(presenceTickMs({ kind: 'yesterday' })).toBe(PRESENCE_TICK_SLOW_MS);
    expect(presenceTickMs({ kind: 'days', n: 3 })).toBe(PRESENCE_TICK_SLOW_MS);
    expect(presenceTickMs({ kind: 'online' })).toBeNull();
    expect(presenceTickMs({ kind: 'unknown' })).toBeNull();
    expect(PRESENCE_TICK_FAST_MS).toBeGreaterThanOrEqual(30_000);
    expect(PRESENCE_TICK_SLOW_MS).toBeLessThanOrEqual(60_000);
  });

  it('a ticking label moves on in both languages as time passes', () => {
    const seen = '2026-11-01T10:00:00Z';
    const p = { online: false, last_active_at: seen, exact: true };
    const start = Date.parse(seen) + 10_000;
    const texts = [0, 1, 2].map((i) =>
      ['en', 'ar'].map((lang) =>
        activeLabelText(activeLabel(p, start + i * PRESENCE_TICK_FAST_MS * 2), lang as 'en' | 'ar'),
      ),
    );
    expect(texts.map(([en]) => en)).toEqual([
      'Active just now',
      'Active 1 minute ago',
      'Active 2 minutes ago',
    ]);
    expect(new Set(texts.map(([, ar]) => ar)).size).toBe(3);
  });

  it('records a bye at most once per account per 30 seconds', () => {
    expect(shouldRecordBye(undefined, 1_000)).toBe(true);
    expect(shouldRecordBye(1_000, 1_000 + PRESENCE_BYE_THROTTLE_MS - 1)).toBe(false);
    expect(shouldRecordBye(1_000, 1_000 + PRESENCE_BYE_THROTTLE_MS)).toBe(true);
    expect(PRESENCE_BYE_THROTTLE_MS).toBe(30_000);
  });
});
