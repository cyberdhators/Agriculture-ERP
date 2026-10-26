import {
  ANALYTICS_BUCKET_LABELS,
  MATCH_ALERT_METRICS,
  MATCH_ALERT_SOURCE_LABELS,
  type MatchAlertCounts,
  type MatchAlertRates,
  type MatchAlertReport,
} from '@agri-erp/shared';

import { formatJubaTime } from '../admin/access-view';
import { CATEGORY_LABELS } from '../buyer/labels';
import { type Cell, type ChartSpec, type Sheet } from './xlsx';
import { type WorkbookContext } from './workbook';

/**
 * THE MATCH-ALERT RESULTS WORKBOOK, AS SHEETS (2026-11-03). Pure, like the
 * analytics workbook it follows: the export route turns these into bytes with
 * buildXlsx, the tests read them directly.
 *
 *   Summary      -- the window, filters, generation time; every figure and rate
 *   By source    -- one row per alert source, with an editable column chart
 *   Over time    -- alerts, conversations and deals per period, with a line chart
 *   Definitions  -- each figure's definition, denominator, source and window,
 *                   then the limitations
 *
 * Aggregated numbers only: nothing in the file identifies a person or a post.
 * A rate with no denominator is "Not measured", never 0.
 */

const bold = (text: string): Cell => ({ text, bold: true });
const rate = (v: number | null): Cell => (v === null ? 'Not measured' : v);

export function matchAlertFilterLabels(report: Pick<MatchAlertReport, 'filters'>): string[] {
  const f = report.filters;
  return [
    f.commodity
      ? (CATEGORY_LABELS[f.commodity as keyof typeof CATEGORY_LABELS] ?? f.commodity)
      : 'All commodities',
    f.product ? `Product contains "${f.product}"` : 'All products',
    f.source ? MATCH_ALERT_SOURCE_LABELS[f.source] : 'All alert sources',
  ];
}

function header(report: MatchAlertReport, ctx: WorkbookContext, title: string): Cell[][] {
  const [commodity, product, source] = matchAlertFilterLabels(report);
  return [
    [bold(title)],
    [
      'Window',
      `${report.window.from} to ${report.window.to} (${report.window.days} days, Juba time)`,
    ],
    ['Data cut-off', `End of ${report.window.to}, Juba time`],
    ['State filter', ctx.stateLabel],
    ['Commodity filter', commodity!],
    ['Product filter', product!],
    ['Source filter', source!],
    ['Scope', ctx.scopeLabel],
    ['Generated', `${formatJubaTime(report.generated_at)} (Africa/Juba)`],
    [],
  ];
}

const FIGURES: readonly { key: keyof MatchAlertCounts; label: string }[] = [
  { key: 'sent', label: 'Alerts sent' },
  { key: 'in_app', label: 'Sent in the app' },
  { key: 'sms', label: 'Sent by SMS' },
  { key: 'read', label: 'Opened' },
  { key: 'conversations', label: 'Conversations started within 7 days' },
  { key: 'deals', label: 'Deals completed within 30 days' },
];

const RATES: readonly { key: keyof MatchAlertRates; label: string; of: string }[] = [
  { key: 'read_rate', label: 'Opened (%)', of: 'of alerts sent in the app' },
  {
    key: 'conversation_rate',
    label: 'Led to a conversation (%)',
    of: 'of alerts whose 7 days are over',
  },
  {
    key: 'deal_rate',
    label: 'Led to a completed deal (%)',
    of: 'of alerts whose 30 days are over',
  },
];

export function matchAlertSheets(report: MatchAlertReport, ctx: WorkbookContext): Sheet[] {
  const t = report.totals;
  const summary: Cell[][] = [
    ...header(report, ctx, 'AgriOne match-alert results'),
    [bold('Figure'), bold('Value'), bold('Note')],
    ...FIGURES.map((f): Cell[] => [f.label, t ? t[f.key] : 'Not measured', '']),
    ...RATES.map((r): Cell[] => [r.label, t ? rate(t[r.key]) : 'Not measured', r.of]),
  ];
  if (!t) summary.push([], ['Not measured: match alerts are not in this database yet.']);

  const sourceIntro: Cell[][] = [
    [bold('Match alerts by source')],
    ['Each alert has one source; the rows add up to the totals.'],
    [],
  ];
  const sourceHead = sourceIntro.length;
  const sourceRows: Cell[][] = [
    ...sourceIntro,
    [bold('Source'), ...FIGURES.map((f) => bold(f.label)), ...RATES.map((r) => bold(r.label))],
    ...report.by_source.map((line): Cell[] => [
      MATCH_ALERT_SOURCE_LABELS[line.source],
      ...FIGURES.map((f) => line[f.key]),
      ...RATES.map((r) => rate(line[r.key])),
    ]),
  ];
  const sourceChart: ChartSpec = {
    kind: 'column',
    title: 'Alerts, conversations and deals by source',
    headerRow: sourceHead,
    firstRow: sourceHead + 1,
    lastRow: sourceHead + report.by_source.length,
    categoryCol: 0,
    // Alerts sent, conversations, deals.
    valueCols: [1, 5, 6],
    at: { col: 0, row: sourceHead + report.by_source.length + 2, cols: 10, rows: 18 },
  };

  const trend = report.trend;
  const trendIntro: Cell[][] = [
    [bold('Match alerts over time')],
    [
      'Per period: alerts sent, and of those alerts how many led to a conversation within 7 days ' +
        'and to a completed deal within 30 days, counted against the period the alert was sent in.',
    ],
    [],
  ];
  const trendHead = trendIntro.length;
  const trendRows: Cell[][] = [
    ...trendIntro,
    [
      bold(ANALYTICS_BUCKET_LABELS[trend.bucket]),
      bold('Alerts sent'),
      bold('Conversations within 7 days'),
      bold('Deals within 30 days'),
    ],
    ...trend.periods.map((p, i): Cell[] => [
      p,
      trend.sent[i] ?? 0,
      trend.conversations[i] ?? 0,
      trend.deals[i] ?? 0,
    ]),
  ];
  const trendChart: ChartSpec = {
    kind: 'line',
    title: 'Match alerts over time',
    headerRow: trendHead,
    firstRow: trendHead + 1,
    lastRow: trendHead + trend.periods.length,
    categoryCol: 0,
    valueCols: [1, 2, 3],
    at: { col: 5, row: 0, cols: 10, rows: 20 },
  };

  const definitions: Cell[][] = [
    ...header(report, ctx, 'Definitions'),
    [bold('Figure'), bold('Definition'), bold('Denominator'), bold('Data source'), bold('Window')],
    ...MATCH_ALERT_METRICS.map((d): Cell[] => [
      d.label,
      d.definition,
      d.denominator,
      d.source,
      d.window,
    ]),
    [],
    [bold('Alert sources')],
    ['Buying-request match', 'A buying request went on the market; people selling it were told.'],
    [
      'Listing match',
      'A produce listing went on the market; people whose buying requests it answers were told.',
    ],
    ['Saved search', 'A post went on the market that answers a saved search; its saver was told.'],
    [],
    [bold('Limitations')],
    ...report.limitations.map((l): Cell[] => [l]),
  ];

  return [
    { name: 'Summary', rows: summary, widths: [36, 14, 34] },
    {
      name: 'By source',
      rows: sourceRows,
      widths: [24, ...FIGURES.map(() => 14), ...RATES.map(() => 16)],
      charts: report.by_source.length > 0 ? [sourceChart] : [],
    },
    {
      name: 'Over time',
      rows: trendRows,
      widths: [16, 14, 18, 16],
      charts: trend.periods.length > 0 ? [trendChart] : [],
    },
    { name: 'Definitions', rows: definitions, widths: [34, 70, 40, 50, 40] },
  ];
}
