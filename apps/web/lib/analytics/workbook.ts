import {
  ANALYTICS_ACTOR_LABELS,
  ANALYTICS_BUCKET_LABELS,
  ANALYTICS_METRICS,
  ANALYTICS_SERIES,
  type AnalyticsBucket,
  type AnalyticsMetricValue,
  type AnalyticsSummary,
  METRIC_GROUP_LABELS,
  type MetricDefinition,
  type SeriesDefinition,
  UNAVAILABLE_TEXT,
} from '@agri-erp/shared';

import { formatJubaTime } from '../admin/access-view';
import { CATEGORY_LABELS } from '../buyer/labels';
import { type Cell, type ChartSpec, type Sheet } from './xlsx';

/**
 * THE ANALYTICS WORKBOOK, AS SHEETS (2026-10-22). Pure: the export route
 * turns these into bytes with buildXlsx, and the tests read them directly.
 *
 *   Summary      -- every figure, with the window, filters and generation time
 *   one sheet per over-time figure (2026-10-28), with an editable chart
 *   one sheet per breakdown that has rows, with an editable chart (2026-10-28)
 *   Definitions  -- what each figure counts, its denominator, source, window
 *                   and state, commodity and actor-type rules, then the
 *                   limitations
 *
 * Numbers are numbers (so a reader can chart them in Excel themselves); a
 * figure that cannot be produced is the word "Not measured" with the reason,
 * never a 0.
 */

const bold = (text: string): Cell => ({ text, bold: true });

const NOT_NARROWED = 'Not narrowed: not measured under this filter.';

/** The label a breakdown key is shown under, on the page and in the workbook. */
export function breakdownLabel(
  def: MetricDefinition,
  item: { key: string; label?: string },
): string {
  return def.breakdown?.keys?.[item.key] ?? item.label ?? item.key;
}

export interface WorkbookContext {
  /** How the export was asked for, as the reader should see it. */
  readonly stateLabel: string;
  readonly scopeLabel: string;
}

/** The commodity and actor-type filters in words (2026-10-28). */
export function narrowingLabels(summary: Pick<AnalyticsSummary, 'commodity' | 'actor_type'>): {
  commodity: string;
  actorType: string;
} {
  return {
    commodity: summary.commodity ? CATEGORY_LABELS[summary.commodity] : 'All commodities',
    actorType: summary.actor_type ? ANALYTICS_ACTOR_LABELS[summary.actor_type] : 'All actor types',
  };
}

function header(summary: AnalyticsSummary, ctx: WorkbookContext, title: string): Cell[][] {
  const narrowing = narrowingLabels(summary);
  return [
    [bold(title)],
    [
      'Window',
      `${summary.window.from} to ${summary.window.to} (${summary.window.days} days, Juba time)`,
    ],
    ['Data cut-off', `End of ${summary.window.to}, Juba time`],
    ['State filter', ctx.stateLabel],
    ['Commodity filter', narrowing.commodity],
    ['Actor-type filter', narrowing.actorType],
    ['Scope', ctx.scopeLabel],
    ['Generated', `${formatJubaTime(summary.generated_at)} (Africa/Juba)`],
    [],
  ];
}

const valueCell = (m: AnalyticsMetricValue): Cell => (m.value === null ? 'Not measured' : m.value);

/** Short tab names: a series label is longer than Excel's 31 characters. */
const SERIES_SHEET_NAMES: Readonly<Record<string, string>> = {
  'series.registrations': 'Registrations over time',
  'series.active_users': 'New and returning over time',
  'series.market_activity': 'Listings and requests over time',
};

const BUCKET_SENTENCE: Readonly<Record<AnalyticsBucket, string>> = {
  day: 'Counted by Juba day.',
  week: 'Counted by week; weeks start on Monday. The first and last week may be partial.',
  month: 'Counted by calendar month. The first and last month may be partial.',
};

/** One over-time figure as a sheet: a table of periods, and a chart drawn from it. */
function seriesSheet(summary: AnalyticsSummary, def: SeriesDefinition): Sheet {
  const value = summary.series.find((s) => s.id === def.id);
  const keys = Object.keys(def.keys);
  const intro: Cell[][] = [
    [bold(def.label)],
    [def.definition],
    [BUCKET_SENTENCE[summary.bucket]],
    ...(def.separateMeasures
      ? [['Different measures side by side: never add the columns together.']]
      : []),
    [],
  ];
  const name = SERIES_SHEET_NAMES[def.id] ?? def.label;
  if (!value || value.lines === null) {
    const why = value?.unavailable ? UNAVAILABLE_TEXT[value.unavailable] : 'Not served.';
    return { name, rows: [...intro, ['Not measured', why]], widths: [16, 60] };
  }
  const lines = value.lines;
  const headerRow = intro.length;
  const rows: Cell[][] = [
    ...intro,
    [bold(ANALYTICS_BUCKET_LABELS[summary.bucket]), ...keys.map((k) => bold(def.keys[k]!))],
    ...value.periods.map((period, i): Cell[] => [
      period,
      ...keys.map((k) => lines.find((l) => l.key === k)?.points[i] ?? 0),
    ]),
  ];
  const chart: ChartSpec = {
    kind: def.chart,
    title: def.label,
    headerRow,
    firstRow: headerRow + 1,
    lastRow: headerRow + value.periods.length,
    categoryCol: 0,
    valueCols: keys.map((_k, i) => i + 1),
    at: { col: keys.length + 2, row: 0, cols: 10, rows: 20 },
  };
  return { name, rows, widths: [16, ...keys.map(() => 18)], charts: [chart] };
}

export function analyticsSheets(summary: AnalyticsSummary, ctx: WorkbookContext): Sheet[] {
  const byId = new Map(summary.metrics.map((m) => [m.id, m]));

  const summaryRows: Cell[][] = [
    ...header(summary, ctx, 'AgriOne marketplace and account analytics'),
    [bold('Group'), bold('Metric'), bold('Value'), bold('Counts'), bold('Note')],
  ];
  for (const def of ANALYTICS_METRICS) {
    const m = byId.get(def.id);
    if (!m) continue;
    summaryRows.push([
      METRIC_GROUP_LABELS[def.group],
      def.label,
      valueCell(m),
      def.unit,
      m.unavailable ? UNAVAILABLE_TEXT[m.unavailable] : def.breakdown ? 'See its own sheet.' : '',
    ]);
  }

  const breakdownSheets: Sheet[] = [];
  for (const def of ANALYTICS_METRICS) {
    const m = byId.get(def.id);
    if (!def.breakdown || !m?.breakdown || m.breakdown.length === 0) continue;
    const rows: Cell[][] = [
      [bold(def.label)],
      [def.definition],
      ...(def.breakdown.overlapping
        ? [
            [
              'The rows overlap: one account can appear in several, so they do not add up to the total.',
            ],
          ]
        : []),
      [],
      [bold(def.breakdown.label), bold('Value')],
      ...m.breakdown.map((b): Cell[] => [breakdownLabel(def, b), b.value]),
      [bold('Total'), m.value],
    ];
    // The chart covers the breakdown rows, never the Total (2026-10-28).
    const headerRow = rows.length - m.breakdown.length - 2;
    const chart: ChartSpec = {
      kind: 'column',
      title: `${def.label} by ${def.breakdown.label.toLowerCase()}`,
      headerRow,
      firstRow: headerRow + 1,
      lastRow: headerRow + m.breakdown.length,
      categoryCol: 0,
      valueCols: [1],
      at: { col: 3, row: 0, cols: 9, rows: 18 },
    };
    breakdownSheets.push({ name: def.label, rows, widths: [42, 12], charts: [chart] });
  }

  const definitionRows: Cell[][] = [
    ...header(summary, ctx, 'Definitions'),
    [
      bold('Metric id'),
      bold('Group'),
      bold('Metric'),
      bold('Counts'),
      bold('Definition'),
      bold('Denominator'),
      bold('Data source'),
      bold('Window'),
      bold('State filter'),
      bold('Commodity filter'),
      bold('Actor-type filter'),
      bold('Breakdown'),
    ],
    ...ANALYTICS_METRICS.map((def): Cell[] => [
      def.id,
      METRIC_GROUP_LABELS[def.group],
      def.label,
      def.unit,
      def.definition,
      def.denominator,
      def.source,
      def.window,
      def.stateRule ?? 'Not located: national figure only.',
      def.commodityRule ?? NOT_NARROWED,
      def.actorRule ?? NOT_NARROWED,
      def.breakdown
        ? `${def.breakdown.label}${def.breakdown.overlapping ? ' (overlapping)' : ''}`
        : '',
    ]),
    ...ANALYTICS_SERIES.map((def): Cell[] => [
      def.id,
      'Over time',
      def.label,
      def.unit,
      def.definition,
      def.denominator,
      def.source,
      def.window,
      def.stateRule,
      def.commodityRule ?? NOT_NARROWED,
      def.actorRule ?? NOT_NARROWED,
      `Lines: ${Object.values(def.keys).join(', ')}${def.separateMeasures ? ' (separate measures)' : ''}`,
    ]),
    [],
    [bold('Limitations')],
    ...summary.limitations.map((l): Cell[] => [l]),
  ];

  return [
    { name: 'Summary', rows: summaryRows, widths: [16, 40, 14, 10, 40] },
    ...ANALYTICS_SERIES.map((def) => seriesSheet(summary, def)),
    ...breakdownSheets,
    {
      name: 'Definitions',
      rows: definitionRows,
      widths: [28, 14, 34, 10, 70, 30, 50, 30, 50, 40, 40, 24],
    },
  ];
}
