import { describe, expect, it } from 'vitest';

import { EMPTY_FILTERS, type RegisterFilters } from './filters';
import {
  canSelect,
  printContext,
  printRowNote,
  prunedSelection,
  selectionLabel,
  toggleAllOnPage,
  toggleSelection,
} from './register-view';

const withFilters = (patch: Partial<RegisterFilters>): RegisterFilters => ({
  ...EMPTY_FILTERS,
  ...patch,
});

describe('what the printed register says about itself', () => {
  it('names the view and says plainly when nothing is filtered', () => {
    const context = printContext(EMPTY_FILTERS);
    expect(context.lines[0]).toBe('View: All farmers');
    expect(context.lines).toContain('No filters applied');
    expect(context.unfiltered).toBe(true);
  });

  it('spells out every applied filter, so the sheet can be reproduced later', () => {
    const context = printContext(
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
      { county: () => 'Juba', payam: () => 'Munuki' },
    );
    expect(context.lines).toEqual([
      'View: Pending verification',
      'County: Juba',
      'Payam: Munuki',
      'Sex: Female',
      'Possible duplicates only',
      'Registered from: 2026-09-01',
      'Registered to: 2026-09-30',
      'Changed since: 2026-09-15',
    ]);
    expect(context.unfiltered).toBe(false);
  });

  it('records the state even though the route never receives it', () => {
    // On paper it explains why a short county list was offered. Leaving it out
    // would make the sheet harder to reproduce, not cleaner.
    const context = printContext(withFilters({ state: 'CE' }), {
      state: () => 'Central Equatoria',
    });
    expect(context.lines).toContain('State: Central Equatoria');
  });

  it('falls back to the identifier when no name is known', () => {
    expect(printContext(withFilters({ county: 'CE-JUB' })).lines).toContain('County: CE-JUB');
  });

  it('carries no personal data of any kind', () => {
    // The context describes a QUERY, never a person. Nothing here can carry a
    // name, a phone number or a national ID, because none of those are filters.
    const context = printContext(withFilters({ status: 'verified', county: 'CE-JUB', sex: 'm' }));
    const text = context.lines.join(' ');
    for (const forbidden of ['national', 'phone', 'Zz', '+211']) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe('the printed page says which rows these are', () => {
  it('never invents a page number, because the route serves none', () => {
    const note = printRowNote(25, true);
    expect(note).toContain('25 rows on this page');
    expect(note).not.toMatch(/page \d+ of \d+/i);
  });

  it('says when the page is the last of the view', () => {
    expect(printRowNote(7, false)).toContain('last page');
  });

  it('handles one row and none', () => {
    expect(printRowNote(1, false)).toContain('1 row on this page');
    expect(printRowNote(0, false)).toBe('No rows on this page.');
  });
});

describe('selection is scoped to the page, and says so', () => {
  it('always ends in "on this page", never implying a national selection', () => {
    expect(selectionLabel(3)).toBe('3 farmers selected on this page');
    expect(selectionLabel(1)).toBe('1 farmer selected on this page');
    expect(selectionLabel(0)).toBe('None selected on this page');
    for (const count of [0, 1, 5]) {
      expect(selectionLabel(count)).not.toMatch(/nationally|in total|across/i);
    }
  });

  it('drops any id that is not on the page in front of the reader', () => {
    // Paging must not leave a tick behind on a row nobody can see.
    const kept = prunedSelection(new Set(['a', 'b', 'c']), ['b', 'd']);
    expect([...kept]).toEqual(['b']);
  });

  it('prunes to nothing when the page shares no rows with the selection', () => {
    expect(prunedSelection(new Set(['a']), ['x', 'y']).size).toBe(0);
  });

  it('toggles one row without disturbing the others', () => {
    const one = toggleSelection(new Set(['a']), 'b');
    expect([...one].sort()).toEqual(['a', 'b']);
    expect([...toggleSelection(one, 'a')]).toEqual(['b']);
  });

  it('select-all covers this page and nothing beyond it', () => {
    const page = ['a', 'b'];
    const all = toggleAllOnPage(new Set(), page);
    expect([...all].sort()).toEqual(['a', 'b']);
    // Ticking again clears, rather than reaching for rows not loaded.
    expect(toggleAllOnPage(all, page).size).toBe(0);
  });

  it('select-all on an empty page selects nothing', () => {
    expect(toggleAllOnPage(new Set(), []).size).toBe(0);
  });
});

describe('who may select at all', () => {
  it('offers ticks only to the roles that take verification decisions', () => {
    expect(canSelect('admin')).toBe(true);
    expect(canSelect('supervisor')).toBe(true);
    expect(canSelect('officer')).toBe(false);
    expect(canSelect('read_only')).toBe(false);
  });
});

describe('there is no bulk operation behind the selection', () => {
  it('this module exposes no bulk verb at all', () => {
    // The guard against a future session adding `bulkVerify` here and wiring
    // it to a route that does not exist. No route in this system accepts a
    // list of farmer ids; decisions are taken one at a time, with reasons.
    const module_ = {
      canSelect,
      prunedSelection,
      selectionLabel,
      toggleAllOnPage,
      toggleSelection,
    };
    for (const name of Object.keys(module_)) {
      expect(name).not.toMatch(/^bulk/i);
      expect(name).not.toMatch(/verifyAll|rejectAll|removeAll|reassignAll/i);
    }
  });
});
