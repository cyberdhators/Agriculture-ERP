import { farmerFilterSchema } from '@agri-erp/shared';
import { describe, expect, it } from 'vitest';

import {
  EMPTY_FILTERS,
  STATUS_TABS,
  activeChips,
  clearPatch,
  fromQuery,
  hasActiveFilters,
  toListParams,
  type RegisterFilters,
} from './filters';

const withFilters = (patch: Partial<RegisterFilters>): RegisterFilters => ({
  ...EMPTY_FILTERS,
  ...patch,
});

describe('what the register sends', () => {
  it('sends nothing when nothing is chosen', () => {
    expect(toListParams(EMPTY_FILTERS)).toEqual({});
  });

  it('every query it builds is accepted by the shared schema', () => {
    // The guarantee that matters: `farmerFilterSchema` is strict, so one key
    // it does not define turns the whole request into a 400 naming a field the
    // reader never typed. This proves the screen cannot construct one.
    const params = toListParams(
      withFilters({
        status: 'pending',
        county: 'CE-JUB',
        payam: 'CE-JUB-MUN',
        sex: 'f',
        duplicate: 'true',
        registered_from: '2026-09-01',
        registered_to: '2026-09-30',
        updated_since: '2026-09-15',
      }),
      'a-cursor',
    );
    const asStrings = Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, String(value)]),
    );
    expect(farmerFilterSchema.safeParse(asStrings).success).toBe(true);
  });

  it('never sends state, because the route does not filter on it', () => {
    const params = toListParams(withFilters({ state: 'CE' }));
    expect(params).toEqual({});
    expect('state' in params).toBe(false);
  });

  it('sends no free text under any key, because no such filter exists', () => {
    const params = toListParams(withFilters({ county: 'CE-JUB', sex: 'f' })) as Record<
      string,
      unknown
    >;
    for (const key of ['q', 'search', 'name', 'phone', 'farmer_number']) {
      expect(params[key], `the register tried to send ${key}`).toBeUndefined();
    }
  });

  it('drops a status that is not one the route knows', () => {
    // `merged` is not a verification status; it is a pointer on the record.
    expect(toListParams(withFilters({ status: 'merged' }))).toEqual({});
    expect(toListParams(withFilters({ status: 'nonsense' }))).toEqual({});
  });

  it('turns a "to" date into the END of that day, so that day is included', () => {
    const params = toListParams(withFilters({ registered_to: '2026-09-03' }));
    expect(params.registered_to).toBe('2026-09-03T23:59:59.999Z');
  });

  it('turns a "from" date into the start of that day', () => {
    expect(toListParams(withFilters({ registered_from: '2026-09-03' })).registered_from).toBe(
      '2026-09-03T00:00:00.000Z',
    );
    expect(toListParams(withFilters({ updated_since: '2026-09-03' })).updated_since).toBe(
      '2026-09-03T00:00:00.000Z',
    );
  });

  it('only accepts a sex and a duplicate flag the schema allows', () => {
    expect(toListParams(withFilters({ sex: 'other' })).sex).toBeUndefined();
    expect(toListParams(withFilters({ duplicate: 'maybe' })).duplicate_flag).toBeUndefined();
    expect(toListParams(withFilters({ duplicate: 'false' })).duplicate_flag).toBe('false');
  });

  it('carries the cursor only when there is one', () => {
    expect(toListParams(EMPTY_FILTERS).cursor).toBeUndefined();
    expect(toListParams(EMPTY_FILTERS, 'abc').cursor).toBe('abc');
  });
});

describe('tabs', () => {
  it('offers only statuses the route can answer', () => {
    expect(STATUS_TABS.map((t) => t.key)).toEqual(['', 'pending', 'verified', 'rejected']);
  });

  it('offers no merged tab', () => {
    expect(STATUS_TABS.some((t) => t.key === 'merged')).toBe(false);
  });
});

describe('chips', () => {
  it('shows one removable chip per active filter', () => {
    const chips = activeChips(withFilters({ county: 'CE-JUB', sex: 'f', duplicate: 'true' }));
    expect(chips.map((c) => c.key)).toEqual(['county', 'sex', 'duplicate']);
    expect(chips[1]?.label).toBe('Sex: Female');
  });

  it('names a place when a name is known and falls back to the identifier', () => {
    const named = activeChips(withFilters({ county: 'CE-JUB' }), {
      county: () => 'Juba',
    });
    expect(named[0]?.label).toBe('County: Juba');
    expect(activeChips(withFilters({ county: 'CE-JUB' }))[0]?.label).toBe('County: CE-JUB');
  });

  it('gives state no chip, because it narrows the pickers and filters nothing', () => {
    expect(activeChips(withFilters({ state: 'CE' }))).toEqual([]);
  });

  it('gives status no chip, because the tab strip already holds it', () => {
    expect(activeChips(withFilters({ status: 'pending' }))).toEqual([]);
  });

  it('distinguishes the two duplicate settings in words', () => {
    expect(activeChips(withFilters({ duplicate: 'true' }))[0]?.label).toBe(
      'Possible duplicates only',
    );
    expect(activeChips(withFilters({ duplicate: 'false' }))[0]?.label).toBe(
      'Excluding possible duplicates',
    );
  });
});

describe('active, cleared and read back', () => {
  it('knows the difference between a narrowed list and an unnarrowed one', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters(withFilters({ status: 'pending' }))).toBe(true);
    expect(hasActiveFilters(withFilters({ county: 'CE-JUB' }))).toBe(true);
    // State alone narrows nothing, so the empty state must not blame filters.
    expect(hasActiveFilters(withFilters({ state: 'CE' }))).toBe(false);
  });

  it('clears every key it owns, so nothing survives a Clear all', () => {
    const patch = clearPatch();
    for (const key of Object.keys(EMPTY_FILTERS)) {
      expect(patch[key], `${key} survived Clear all`).toBeNull();
    }
  });

  it('reads filters back out of the URL and ignores anything else', () => {
    const query: Record<string, string> = { status: 'verified', county: 'CE-JUB', q: 'ignored' };
    const filters = fromQuery((key) => query[key] ?? '');
    expect(filters.status).toBe('verified');
    expect(filters.county).toBe('CE-JUB');
    expect(Object.keys(filters)).not.toContain('q');
  });
});
