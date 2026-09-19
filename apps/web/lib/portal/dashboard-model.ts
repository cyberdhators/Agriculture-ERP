import { AGE_BANDS } from '@agri-erp/shared';

import type { Breakdown, Summary } from '@/lib/reports/api';

/**
 * THE DASHBOARD'S ARITHMETIC AND LABELLING, AWAY FROM THE SCREEN.
 *
 * Every derivation the national overview makes — the donut's geometry, the
 * human labels for a breakdown key, which figures the summary route actually
 * carries — is here, as pure functions over the `Summary` the server returned.
 * The component renders; it does not calculate. That is why these can be
 * tested without a browser, and why a wrong percentage shows up as a red test
 * rather than as a plausible-looking chart.
 *
 * THE RULE THAT MATTERS MOST. `null` means the routes do not carry the figure.
 * `0` means the figure was measured and is zero. Nothing in this file ever
 * turns the first into the second, because on a dashboard a zero is
 * reassuring and an unmeasured figure is not.
 */

/* ---- Labels ----------------------------------------------------------- */

const AGE_BAND_LABELS: Record<string, string> = {
  under_18: 'Under 18',
  '18_24': '18 to 24',
  '25_34': '25 to 34',
  '35_49': '35 to 49',
  '50_plus': '50 and over',
};

const SEX_LABELS: Record<string, string> = {
  f: 'Women',
  m: 'Men',
};

/** Age bands are computed from a year of birth, so the label never implies an exact age. */
export const ageBandLabel = (key: string): string => AGE_BAND_LABELS[key] ?? key;
export const sexLabel = (key: string): string => SEX_LABELS[key] ?? key;

/** Every band the server can report, in order, so an empty band still has a row. */
export const AGE_BAND_KEYS: readonly string[] = AGE_BANDS.map((band) => band.key);

/* ---- Donut ------------------------------------------------------------ */

export type StatusKey = 'verified' | 'pending' | 'rejected' | 'merged';

export interface DonutSegment {
  key: StatusKey;
  label: string;
  value: number;
  /** Whole percent of the whole, for the text a screen reader is given. */
  percent: number;
  /** stroke-dasharray and -dashoffset for a circle of circumference 100. */
  dash: string;
  offset: number;
}

export const STATUS_LABELS: Record<StatusKey, string> = {
  verified: 'Verified',
  pending: 'Pending',
  rejected: 'Rejected',
  merged: 'Merged',
};

/**
 * The donut, as four arcs on a circle whose circumference is 100 — so a
 * segment's length IS its percentage and no coordinate maths is needed.
 *
 * Returns null when every value is zero: a donut of four zero-length arcs is
 * a grey ring that looks like a chart and says nothing. The caller shows an
 * empty state instead.
 */
export function donutSegments(farmers: Summary['farmers']): DonutSegment[] | null {
  const order: StatusKey[] = ['verified', 'pending', 'rejected', 'merged'];
  const total = order.reduce((sum, key) => sum + (farmers[key] ?? 0), 0);
  if (total <= 0) return null;

  let cursor = 0;
  return order.map((key) => {
    const value = farmers[key] ?? 0;
    const share = (value / total) * 100;
    const segment: DonutSegment = {
      key,
      label: STATUS_LABELS[key],
      value,
      percent: Math.round(share),
      dash: `${share} ${100 - share}`,
      // Arcs start at twelve o'clock and run clockwise, each after the last.
      offset: -cursor,
    };
    cursor += share;
    return segment;
  });
}

/** The sentence a screen reader is given instead of the ring. */
export function donutSummaryText(segments: readonly DonutSegment[]): string {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const parts = segments.map((s) => `${s.label} ${s.value.toLocaleString('en')} (${s.percent}%)`);
  return `${total.toLocaleString('en')} records in the register: ${parts.join(', ')}.`;
}

/* ---- Breakdowns ------------------------------------------------------- */

export interface BreakdownRow {
  key: string;
  label: string;
  value: number;
}

/**
 * A breakdown as chart rows, largest first, with a name where one is known.
 *
 * Sorting by size is not ranking. The bars carry counts and nothing else —
 * no position label, no "top performer", no target — because a state with
 * fewer verified farmers may simply be a state with fewer farmers, and a
 * dashboard that implies otherwise invites the wrong conversation.
 */
export function breakdownRows(
  rows: readonly Breakdown[],
  nameOf: (key: string) => string | undefined,
  limit?: number,
): BreakdownRow[] {
  const mapped = rows
    .map((row) => ({ key: row.key, label: nameOf(row.key) ?? row.key, value: row.verified }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  return limit === undefined ? mapped : mapped.slice(0, limit);
}

/** Age bands in their natural order, with absent bands shown as zero. */
export function ageBandRows(rows: readonly Breakdown[]): BreakdownRow[] {
  const found = new Map(rows.map((row) => [row.key, row.verified]));
  return AGE_BAND_KEYS.map((key) => ({
    key,
    label: ageBandLabel(key),
    value: found.get(key) ?? 0,
  }));
}

export function sexRows(rows: readonly Breakdown[]): BreakdownRow[] {
  return rows
    .map((row) => ({ key: row.key, label: sexLabel(row.key), value: row.verified }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/* ---- What the summary does and does not carry ------------------------- */

export interface UnavailableMetric {
  readonly label: string;
  readonly because: string;
}

/**
 * The figures this dashboard is asked for that `GET /api/reports/summary` does
 * not carry. Listed in one place so the "Data notes" section and the cards
 * cannot drift apart, and so the backend work is named rather than implied.
 */
export const UNAVAILABLE_METRICS: readonly UnavailableMetric[] = [
  {
    label: 'Farmers without a working officer',
    because:
      'Requires officer-assignment status in the summary data: a count of farmers whose caseload officer is no longer active.',
  },
  {
    label: 'Active extension officers',
    because:
      'The officers list is cursor-paginated with no total, so any figure here would count the first page only.',
  },
  {
    label: 'Registration activity over time',
    because:
      'The summary route answers a single cut-off, not a series. Historical registration data is not exposed.',
  },
  {
    label: 'GPS accuracy of boundaries',
    because:
      'Boundary accuracy grades are recorded per boundary but are not aggregated in the summary.',
  },
];

/**
 * Whether the register holds anything at all in this scope.
 *
 * Distinguishes "measured, and everything is zero" from "nothing measured":
 * the first is an empty register, the second is a figure we do not have.
 */
export const registerIsEmpty = (farmers: Summary['farmers']): boolean =>
  farmers.verified + farmers.pending + farmers.rejected + farmers.merged === 0;
