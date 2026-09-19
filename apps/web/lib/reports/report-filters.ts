import { SEASON_PATTERN, type ReportFilter } from '@agri-erp/shared';

/**
 * THE REPORT'S FILTERS, AND WHAT AN EXPORT WILL ACTUALLY CONTAIN.
 *
 * `reportFilterSchema` is the contract, and the SAME filters drive the figures
 * on screen and the export taken from them (C-10.9) — which is the only reason
 * an export can be checked against the report it came from.
 *
 * TWO DATES THAT ARE NOT THE SAME DATE. This is the trap this module exists to
 * avoid. `cutoff` bounds the CUMULATIVE REGISTER: how many farmers were
 * verified, pending, rejected or merged as of that day. `from`/`to` bound
 * VISITS, by the server's moment of receipt — they move reach and visit
 * figures and leave every register count untouched. A single "date range" at
 * the top of a report, implying it filters everything, would be wrong about
 * most of the page. They are labelled separately and described separately.
 */

export interface ReportFilterState {
  cutoff: string;
  from: string;
  to: string;
  season: string;
  state: string;
  county: string;
  payam: string;
}

export const EMPTY_REPORT_FILTERS: ReportFilterState = {
  cutoff: '',
  from: '',
  to: '',
  season: '',
  state: '',
  county: '',
  payam: '',
};

export const REPORT_FILTER_KEYS = Object.keys(EMPTY_REPORT_FILTERS) as (keyof ReportFilterState)[];

/**
 * The seasons the schema will accept, newest first.
 *
 * `SEASON_PATTERN` is `YYYY-main` or `YYYY-second`. The screen used to offer a
 * free-text box hinting "2026A", which the schema rejects — a placeholder that
 * taught a format the server refuses. A closed list cannot do that.
 */
export function seasonOptions(now: Date = new Date(), years = 3): string[] {
  const current = now.getUTCFullYear();
  const out: string[] = [];
  for (let i = 0; i < years; i += 1) {
    out.push(`${current - i}-second`, `${current - i}-main`);
  }
  return out.filter((season) => SEASON_PATTERN.test(season));
}

/** Only what the schema defines, and only when it has a value. */
export function toReportFilter(state: ReportFilterState): ReportFilter {
  const filter: ReportFilter = {};
  if (state.cutoff) filter.cutoff = state.cutoff;
  // The form offers dates; the schema wants timestamps with an offset. A "to"
  // date means the END of that day, or the day's own visits fall outside it.
  if (state.from) filter.from = `${state.from}T00:00:00.000Z`;
  if (state.to) filter.to = `${state.to}T23:59:59.999Z`;
  if (state.season) filter.season = state.season;
  if (state.state) filter.state = state.state;
  if (state.county) filter.county = state.county;
  if (state.payam) filter.payam = state.payam;
  return filter;
}

export function fromQuery(get: (key: string) => string): ReportFilterState {
  const state = { ...EMPTY_REPORT_FILTERS };
  for (const key of REPORT_FILTER_KEYS) state[key] = get(key) ?? '';
  return state;
}

export const clearReportFilters = (): Record<string, null> =>
  Object.fromEntries(REPORT_FILTER_KEYS.map((key) => [key, null]));

export interface ReportChip {
  key: keyof ReportFilterState;
  label: string;
  /** Which part of the report this filter actually moves. */
  affects: 'register' | 'visits' | 'all';
}

export interface PlaceNames {
  state?: (id: string) => string | undefined;
  county?: (id: string) => string | undefined;
  payam?: (id: string) => string | undefined;
}

/**
 * Active filters as chips, each saying WHAT IT MOVES.
 *
 * A chip reading "Period from 1 September" beside a verified count of 12,480
 * invites the reader to believe 12,480 farmers were verified in September.
 * They were not — that is a cumulative total as of the cut-off. The chip says
 * "visits" so the sentence cannot be misread.
 */
export function reportChips(state: ReportFilterState, names: PlaceNames = {}): ReportChip[] {
  const chips: ReportChip[] = [];
  if (state.cutoff) {
    chips.push({ key: 'cutoff', label: `Figures as of ${state.cutoff}`, affects: 'all' });
  }
  if (state.from) {
    chips.push({ key: 'from', label: `Visits from ${state.from}`, affects: 'visits' });
  }
  if (state.to) chips.push({ key: 'to', label: `Visits to ${state.to}`, affects: 'visits' });
  if (state.season) chips.push({ key: 'season', label: `Season ${state.season}`, affects: 'all' });
  if (state.state) {
    chips.push({
      key: 'state',
      label: `State: ${names.state?.(state.state) ?? state.state}`,
      affects: 'all',
    });
  }
  if (state.county) {
    chips.push({
      key: 'county',
      label: `County: ${names.county?.(state.county) ?? state.county}`,
      affects: 'all',
    });
  }
  if (state.payam) {
    chips.push({
      key: 'payam',
      label: `Payam: ${names.payam?.(state.payam) ?? state.payam}`,
      affects: 'all',
    });
  }
  return chips;
}

export const hasReportFilters = (state: ReportFilterState): boolean =>
  reportChips(state).length > 0;

/* ---- What an export contains ----------------------------------------- */

export type ReportKind = 'summary' | 'farmers';

/**
 * THE COLUMNS OF THE FARMER-LIST EXPORT, AS THE SERVER BUILDS THEM.
 *
 * Copied from the SELECT in lib/api/reporting.ts so an administrator can see,
 * before generating anything, exactly what leaves the building. C-10.11: the
 * farmer list carries FARMER NUMBERS AND NEVER NAMES — and it also carries no
 * phone, no national ID and no rejection note. Those are not omitted by
 * politeness; they are absent from the query.
 */
export const FARMER_EXPORT_COLUMNS: readonly string[] = [
  'farmer_number',
  'verification_status',
  'sex',
  'age_band',
  'state_id',
  'county_id',
  'payam_id',
  'registered_at',
  'reached',
];

/** Fields that must never appear in an export, asserted by test. */
export const EXPORT_FORBIDDEN_FIELDS: readonly string[] = [
  'given_name',
  'family_name',
  'name',
  'phone',
  'national_id',
  'rejection',
  'note',
  'password',
  'observation',
];

export interface ExportDescription {
  kind: ReportKind;
  title: string;
  contains: string;
  columns: readonly string[];
  privacy: string;
}

export function describeExport(kind: ReportKind): ExportDescription {
  if (kind === 'farmers') {
    return {
      kind,
      title: 'Farmer list',
      contains: 'One row per farmer in scope, ordered by state, county, payam and farmer number.',
      columns: FARMER_EXPORT_COLUMNS,
      privacy:
        'Farmers are identified by farmer number only. No name, phone number, national ID or rejection note is included — the export query does not select them.',
    };
  }
  return {
    kind,
    title: 'Summary figures',
    contains:
      'The same figures shown on this page: register status, reach, land, and the breakdowns by sex, age band, state, county, payam and crop.',
    columns: ['register status', 'reach', 'land', 'breakdowns'],
    privacy: 'No farmer is named in the summary; it contains counts only.',
  };
}

/**
 * The row count, before the export runs.
 *
 * There is none. The route counts rows as it builds the export and reports the
 * figure in the log afterwards; nothing offers a count in advance, and
 * estimating one from a page of the register would be a guess dressed as a
 * fact. Said in words rather than shown as a number.
 */
export const ROW_COUNT_UNKNOWN =
  'The number of rows is counted by the server as the export runs, and is recorded in the export log.';
