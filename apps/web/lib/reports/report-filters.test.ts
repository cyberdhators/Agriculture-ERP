import { SEASON_PATTERN, reportFilterSchema } from '@agri-erp/shared';
import { describe, expect, it } from 'vitest';

import {
  EMPTY_REPORT_FILTERS,
  EXPORT_FORBIDDEN_FIELDS,
  FARMER_EXPORT_COLUMNS,
  ROW_COUNT_UNKNOWN,
  clearReportFilters,
  describeExport,
  fromQuery,
  hasReportFilters,
  reportChips,
  seasonOptions,
  toReportFilter,
  type ReportFilterState,
} from './report-filters';

const withFilters = (patch: Partial<ReportFilterState>): ReportFilterState => ({
  ...EMPTY_REPORT_FILTERS,
  ...patch,
});

describe('what the report sends', () => {
  it('sends nothing when nothing is chosen', () => {
    expect(toReportFilter(EMPTY_REPORT_FILTERS)).toEqual({});
  });

  it('every query it builds is accepted by the shared schema', () => {
    const filter = toReportFilter(
      withFilters({
        cutoff: '2026-09-01',
        from: '2026-09-01',
        to: '2026-09-10',
        season: '2026-main',
        state: 'CE',
        county: 'CE-JUB',
        payam: 'CE-JUB-MUN',
      }),
    );
    expect(reportFilterSchema.safeParse(filter).success).toBe(true);
  });

  it('sends no filter the schema does not define', () => {
    const filter = toReportFilter(withFilters({ state: 'CE' })) as Record<string, unknown>;
    for (const invented of ['crop', 'officer', 'status', 'q', 'search', 'role']) {
      expect(filter[invented], `sent an unsupported ${invented}`).toBeUndefined();
    }
  });

  it('closes the visit period at the end of the day so that day counts', () => {
    const filter = toReportFilter(withFilters({ from: '2026-09-01', to: '2026-09-30' }));
    expect(filter.from).toBe('2026-09-01T00:00:00.000Z');
    expect(filter.to).toBe('2026-09-30T23:59:59.999Z');
  });

  it('refuses a cut-off in the future, as the schema does', () => {
    // `isoDate` rejects a cut-off later than now: a report "as of" a date that
    // has not happened would be a report of nothing, presented as a total. The
    // date input carries a `max` of today for the same reason.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const filter = toReportFilter(withFilters({ cutoff: tomorrow }));
    expect(reportFilterSchema.safeParse(filter).success).toBe(false);
  });

  it('reads filters back out of the URL and ignores anything else', () => {
    const query: Record<string, string> = { cutoff: '2026-09-01', state: 'CE', junk: 'x' };
    const state = fromQuery((key) => query[key] ?? '');
    expect(state.cutoff).toBe('2026-09-01');
    expect(state.state).toBe('CE');
    expect(Object.keys(state)).not.toContain('junk');
  });

  it('clears every key it owns', () => {
    for (const [, value] of Object.entries(clearReportFilters())) expect(value).toBeNull();
  });
});

describe('seasons are offered in the form the schema accepts', () => {
  it('offers only seasons matching the shared pattern', () => {
    for (const season of seasonOptions(new Date('2026-06-01T00:00:00Z'))) {
      expect(SEASON_PATTERN.test(season), `${season} would be refused`).toBe(true);
    }
  });

  it('never offers the format the old free-text hint taught', () => {
    // The screen used to hint "2026A", which `SEASON_PATTERN` rejects outright.
    const options = seasonOptions(new Date('2026-06-01T00:00:00Z'));
    expect(options).not.toContain('2026A');
    expect(options[0]).toBe('2026-second');
    expect(options).toContain('2026-main');
  });
});

describe('a chip says which figures its filter actually moves', () => {
  it('marks the visit period as affecting visits, not the register', () => {
    // The trap: "Period from 1 September" beside a verified count invites the
    // reader to think those farmers were verified in September. They were not.
    const chips = reportChips(withFilters({ from: '2026-09-01', to: '2026-09-30' }));
    expect(chips.map((c) => c.affects)).toEqual(['visits', 'visits']);
    expect(chips[0]?.label).toContain('Visits from');
  });

  it('marks the cut-off as affecting everything', () => {
    const chips = reportChips(withFilters({ cutoff: '2026-09-01' }));
    expect(chips[0]?.affects).toBe('all');
    expect(chips[0]?.label).toBe('Figures as of 2026-09-01');
  });

  it('names a place when a name is known and keeps the identifier otherwise', () => {
    expect(
      reportChips(withFilters({ state: 'CE' }), { state: () => 'Central Equatoria' })[0]?.label,
    ).toBe('State: Central Equatoria');
    expect(reportChips(withFilters({ state: 'CE' }))[0]?.label).toBe('State: CE');
  });

  it('knows whether anything narrows the report', () => {
    expect(hasReportFilters(EMPTY_REPORT_FILTERS)).toBe(false);
    expect(hasReportFilters(withFilters({ payam: 'CE-JUB-MUN' }))).toBe(true);
  });
});

describe('what an export will contain, stated before it runs', () => {
  it('the farmer list is identified by farmer number and by nothing else', () => {
    const description = describeExport('farmers');
    expect(description.columns).toContain('farmer_number');
    expect(description.privacy).toMatch(/farmer number only/i);
  });

  it('NO NAME, PHONE, NATIONAL ID OR REJECTION NOTE IS EVER A COLUMN', () => {
    // C-10.11. The guarantee is the server's — those fields are not in the
    // export query at all — and this pins the description so a later session
    // cannot quietly widen it.
    const columns = FARMER_EXPORT_COLUMNS.join(' ').toLowerCase();
    for (const forbidden of EXPORT_FORBIDDEN_FIELDS) {
      expect(columns, `${forbidden} appeared in the export columns`).not.toContain(forbidden);
    }
  });

  it('lists exactly the columns the export query selects', () => {
    expect([...FARMER_EXPORT_COLUMNS]).toEqual([
      'farmer_number',
      'verification_status',
      'sex',
      'age_band',
      'state_id',
      'county_id',
      'payam_id',
      'registered_at',
      'reached',
    ]);
  });

  it('the summary export names no farmer at all', () => {
    expect(describeExport('summary').privacy).toMatch(/counts only/i);
  });

  it('does not pretend to know the row count in advance', () => {
    // The route counts as it builds and records the figure in the log. An
    // estimate here would be a guess dressed as a fact.
    expect(ROW_COUNT_UNKNOWN).toMatch(/counted by the server/i);
    expect(ROW_COUNT_UNKNOWN).not.toMatch(/\d/);
  });
});
