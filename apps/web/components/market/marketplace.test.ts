import { describe, expect, it } from 'vitest';

import { liveCount, moreFromSeller, type MarketRow } from './marketplace';

/**
 * "More from this seller" (2026-10-24, found by the client acceptance test):
 * a public listing carries no farmer id, so an empty key matched every
 * listing on the market and the seller card counted all of them.
 */
const row = (id: string, seller: string, status = 'listed') =>
  ({
    listing: { id, farmer_id: seller, status, updated_at: '2026-10-24T00:00:00Z' },
    seller: { id: seller },
  }) as unknown as MarketRow;

const rows = [row('a', 'k1'), row('b', 'k1'), row('c', 'k2'), row('d', 'k1', 'withdrawn')];

describe('more from this seller', () => {
  it("shows only that seller's other live listings", () => {
    expect(moreFromSeller(rows, 'k1', 'a').map((r) => r.listing.id)).toEqual(['b']);
  });

  it('shows nothing, rather than everything, when the seller is unknown', () => {
    expect(moreFromSeller(rows, '', 'a')).toEqual([]);
    expect(moreFromSeller([row('x', ''), row('y', '')], '', 'x')).toEqual([]);
  });

  it("counts only that seller's live listings", () => {
    expect(liveCount(rows, 'k1')).toBe(2);
    expect(liveCount(rows, '')).toBe(0);
  });
});
