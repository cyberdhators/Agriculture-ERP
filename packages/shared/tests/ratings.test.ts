import { describe, expect, it } from 'vitest';

import {
  RATING_LATEST_SHOWN,
  RATING_WINDOW_DAYS,
  moderateRatingSchema,
  ratingAverage,
  ratingRefusal,
  ratingVisible,
  ratingWindowEnds,
  reportRatingSchema,
  submitRatingSchema,
  summarizeRatings,
  type RatingEligibilityInput,
  type RatingSummaryRow,
} from '../src/index';

/**
 * RATINGS AFTER A COMPLETED DEAL (2026-11-03, lane-trust). The rule is pure,
 * so it is proved here without a database: only the two parties, only a
 * completed deal, once per side, within 30 days; the average counts visible
 * ratings only; a hidden rating or a suspended rater's rating counts nowhere.
 */

const DAY = 24 * 60 * 60 * 1000;
const completedAt = new Date('2026-11-01T10:00:00Z');
const base: RatingEligibilityInput = {
  isParty: true,
  completed: true,
  completedAt,
  alreadyRated: false,
  blocked: false,
  now: new Date(completedAt.getTime() + DAY),
};

describe('who may rate, and when', () => {
  it('a party to a completed deal, inside the window, who has not rated, may rate', () => {
    expect(ratingRefusal(base)).toBeNull();
  });

  it('only parties: a stranger is refused before anything else is said', () => {
    expect(ratingRefusal({ ...base, isParty: false })).toBe('not_party');
    expect(ratingRefusal({ ...base, isParty: false, completed: false, alreadyRated: true })).toBe(
      'not_party',
    );
  });

  it('only completed deals', () => {
    expect(ratingRefusal({ ...base, completed: false })).toBe('not_completed');
    expect(ratingRefusal({ ...base, completedAt: null })).toBe('not_completed');
  });

  it('once per side', () => {
    expect(ratingRefusal({ ...base, alreadyRated: true })).toBe('already_rated');
  });

  it(`within ${RATING_WINDOW_DAYS} days of completion, and not a moment after`, () => {
    const end = ratingWindowEnds(completedAt);
    expect(end.getTime() - completedAt.getTime()).toBe(30 * DAY);
    expect(ratingRefusal({ ...base, now: end })).toBeNull();
    expect(ratingRefusal({ ...base, now: new Date(end.getTime() + 1) })).toBe('window_closed');
    expect(ratingWindowEnds(completedAt.toISOString()).getTime()).toBe(end.getTime());
  });

  it('not between two people one of whom blocked the other', () => {
    expect(ratingRefusal({ ...base, blocked: true })).toBe('blocked');
  });
});

describe('what a rating may say', () => {
  const ok = {
    deal_kind: 'conversation',
    deal_id: '00000000-0000-4000-8000-000000000001',
    stars: 4,
  };

  it('1 to 5 whole stars', () => {
    expect(submitRatingSchema.safeParse(ok).success).toBe(true);
    for (const stars of [0, 6, 3.5, '4', null]) {
      const r = submitRatingSchema.safeParse({ ...ok, stars });
      expect(r.success, String(stars)).toBe(false);
      expect(r.error?.issues[0]?.message).toBe('Choose from 1 to 5 stars.');
    }
  });

  it('a comment of at most 300 characters; an empty one is none', () => {
    expect(submitRatingSchema.safeParse({ ...ok, comment: 'x'.repeat(300) }).success).toBe(true);
    const long = submitRatingSchema.safeParse({ ...ok, comment: 'x'.repeat(301) });
    expect(long.error?.issues[0]?.message).toBe('A comment has at most 300 characters.');
    expect(submitRatingSchema.parse({ ...ok, comment: '   ' }).comment).toBeUndefined();
  });

  it('only the two kinds of deal, and nothing it does not know', () => {
    expect(submitRatingSchema.safeParse({ ...ok, deal_kind: 'listing' }).success).toBe(false);
    expect(submitRatingSchema.safeParse({ ...ok, rater: 'someone' }).success).toBe(false);
  });

  it('a report names a product-report reason; a hide needs a reason', () => {
    expect(reportRatingSchema.safeParse({ reason: 'inappropriate_content' }).success).toBe(true);
    expect(reportRatingSchema.safeParse({ reason: 'rude' }).success).toBe(false);
    expect(moderateRatingSchema.safeParse({ action: 'hide' }).error?.issues[0]?.message).toBe(
      'Give the reason for hiding this rating.',
    );
    expect(moderateRatingSchema.safeParse({ action: 'hide', reason: 'Abusive' }).success).toBe(
      true,
    );
    expect(moderateRatingSchema.safeParse({ action: 'restore' }).success).toBe(true);
    expect(moderateRatingSchema.safeParse({ action: 'dismiss_report' }).success).toBe(true);
  });
});

describe('averages', () => {
  it('none is no average, not zero', () => {
    expect(ratingAverage([])).toEqual({ average: null, count: 0 });
  });

  it('to one decimal place', () => {
    expect(ratingAverage([5, 4, 4])).toEqual({ average: 4.3, count: 3 });
    expect(ratingAverage([1, 2])).toEqual({ average: 1.5, count: 2 });
    expect(ratingAverage([5])).toEqual({ average: 5, count: 1 });
  });
});

describe('hiding', () => {
  const row = (over: Partial<RatingSummaryRow> = {}): RatingSummaryRow => ({
    stars: 5,
    comment: 'Good maize, on time.',
    rater_name: 'Mary K.',
    created_at: '2026-11-02T10:00:00Z',
    hidden_at: null,
    deleted_at: null,
    rater_live: true,
    ...over,
  });

  it('a hidden, removed or suspended/disabled rater’s rating is not visible', () => {
    expect(ratingVisible(row())).toBe(true);
    expect(ratingVisible(row({ hidden_at: '2026-11-03T00:00:00Z' }))).toBe(false);
    expect(ratingVisible(row({ deleted_at: '2026-11-03T00:00:00Z' }))).toBe(false);
    expect(ratingVisible(row({ rater_live: false }))).toBe(false);
  });

  it('the summary counts and averages visible ratings only', () => {
    const summary = summarizeRatings([
      row({ stars: 5 }),
      row({ stars: 3 }),
      row({ stars: 1, hidden_at: '2026-11-03T00:00:00Z', comment: 'abuse' }),
      row({ stars: 1, rater_live: false, comment: 'from a suspended account' }),
    ]);
    expect(summary.count).toBe(2);
    expect(summary.average).toBe(4);
    expect(summary.latest.map((r) => r.comment)).not.toContain('abuse');
    expect(summary.latest.map((r) => r.comment)).not.toContain('from a suspended account');
  });

  it('the latest comments: newest first, only those with words, at most five, no ids', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      row({ created_at: `2026-11-0${i + 1}T10:00:00Z`, comment: i === 7 ? null : `c${i}` }),
    );
    const { latest } = summarizeRatings(rows);
    expect(latest).toHaveLength(RATING_LATEST_SHOWN);
    expect(latest[0]?.comment).toBe('c6');
    for (const r of latest) {
      expect(Object.keys(r).sort()).toEqual(['comment', 'created_at', 'rater_name', 'stars']);
    }
  });
});
