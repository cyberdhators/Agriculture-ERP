import { describe, expect, it } from 'vitest';

import {
  applyFilters,
  DEFAULT_FILTERS,
  type MarketFilters,
} from '../components/market/marketplace';
import { COUNTIES, PAYAMS, STATES } from '../lib/fixtures/p1';
import { NATIONAL_COUNTIES, NATIONAL_PAYAMS, NATIONAL_STATES } from '../lib/places/national';

/**
 * THE PLACE LISTS THE FORMS OFFER ARE THE NATIONAL LIST (2026-10-31).
 *
 * The database was loaded with CORWADO's reference on 30 October, but the
 * sign-up form, "Your details", an officer's registration and "Start selling"
 * read a built-in list of twelve Juba payams, and the marketplace's payam
 * filter offered only payams that had a listing. The forms now read
 * lib/places/national.ts, generated from the same CSV as the database.
 */

describe('the built-in place list', () => {
  it('is exactly docs/data/locations.csv (rerun scripts/places-module.mjs after a CSV edit)', async () => {
    const { loadSource, toTree } = await import('../../../scripts/locations-lib.mjs');
    const tree = toTree(loadSource().rows);
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
    expect(ids([...NATIONAL_STATES])).toEqual(ids(tree.states));
    expect(ids([...NATIONAL_COUNTIES])).toEqual(ids(tree.counties));
    expect(ids([...NATIONAL_PAYAMS])).toEqual(ids(tree.payams));
    const names = new Map(tree.payams.map((p: { id: string; name: string }) => [p.id, p.name]));
    for (const p of NATIONAL_PAYAMS) expect(p.name, p.id).toBe(names.get(p.id));
  });

  it('is what the forms offer: every state, county and payam', () => {
    expect(STATES).toHaveLength(13);
    expect(COUNTIES).toHaveLength(83);
    expect(PAYAMS).toHaveLength(505);
    expect(PAYAMS.some((p) => p.stateId === 'NB')).toBe(true);
  });
});

describe('the marketplace place filter', () => {
  const row = (payam_id: string | null) =>
    ({
      listing: { status: 'listed', available_from: '2026-01-01' },
      seller: { payam_id },
    }) as never;
  const rows = [row('CE-JUB-BUN'), row('CE-YEI-YEI'), row('NB-AWE-AC2'), row(null)];
  const run = (f: Partial<MarketFilters>) =>
    applyFilters(rows, { ...DEFAULT_FILTERS, ...f }, '2026-10-31', 'public').map(
      (r) => (r as { seller: { payam_id: string | null } }).seller.payam_id,
    );

  it('narrows by state, by county and by payam', () => {
    expect(run({ state: 'CE' })).toEqual(['CE-JUB-BUN', 'CE-YEI-YEI']);
    expect(run({ state: 'CE', county: 'CE-JUB' })).toEqual(['CE-JUB-BUN']);
    expect(run({ state: 'NB', county: 'NB-AWE', payam: 'NB-AWE-AC2' })).toEqual(['NB-AWE-AC2']);
    expect(run({})).toHaveLength(4);
  });
});
