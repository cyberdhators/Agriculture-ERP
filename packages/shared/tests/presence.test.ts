import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PREFERENCES,
  activeLabel,
  activeLabelText,
  counterpartVisible,
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
