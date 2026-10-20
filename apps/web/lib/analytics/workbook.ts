import {
  ANALYTICS_METRICS,
  type AnalyticsMetricValue,
  type AnalyticsSummary,
  METRIC_GROUP_LABELS,
  type MetricDefinition,
  UNAVAILABLE_TEXT,
} from '@agri-erp/shared';

import { formatJubaTime } from '../admin/access-view';
import { type Cell, type Sheet } from './xlsx';

/**
 * THE ANALYTICS WORKBOOK, AS SHEETS (2026-10-22). Pure: the export route
 * turns these into bytes with buildXlsx, and the tests read them directly.
 *
 *   Summary      -- every figure, with the window, filters and generation time
 *   one sheet per breakdown that has rows
 *   Definitions  -- what each figure counts, its denominator, source, window
 *                   and state rule, then the limitations
 *
 * Numbers are numbers (so a reader can chart them in Excel themselves); a
 * figure that cannot be produced is the word "Not measured" with the reason,
 * never a 0.
 */

const bold = (text: string): Cell => ({ text, bold: true });

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

function header(summary: AnalyticsSummary, ctx: WorkbookContext, title: string): Cell[][] {
  return [
    [bold(title)],
    [
      'Window',
      `${summary.window.from} to ${summary.window.to} (${summary.window.days} days, Juba time)`,
    ],
    ['Data cut-off', `End of ${summary.window.to}, Juba time`],
    ['State filter', ctx.stateLabel],
    ['Scope', ctx.scopeLabel],
    ['Generated', `${formatJubaTime(summary.generated_at)} (Africa/Juba)`],
    [],
  ];
}

const valueCell = (m: AnalyticsMetricValue): Cell => (m.value === null ? 'Not measured' : m.value);

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
    breakdownSheets.push({ name: def.label, rows, widths: [42, 12] });
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
      def.breakdown
        ? `${def.breakdown.label}${def.breakdown.overlapping ? ' (overlapping)' : ''}`
        : '',
    ]),
    [],
    [bold('Limitations')],
    ...summary.limitations.map((l): Cell[] => [l]),
  ];

  return [
    { name: 'Summary', rows: summaryRows, widths: [16, 40, 14, 10, 40] },
    ...breakdownSheets,
    {
      name: 'Definitions',
      rows: definitionRows,
      widths: [28, 14, 34, 10, 70, 30, 50, 30, 50, 24],
    },
  ];
}
