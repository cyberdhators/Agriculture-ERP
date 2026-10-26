import { z } from 'zod';

import {
  ANALYTICS_MESSAGES,
  type AnalyticsBucket,
  type AnalyticsWindow,
  analyticsBucket,
  analyticsFilterSchema,
  bucketStarts,
} from './analytics';
import { MATCH_ALERT_SOURCES, type MatchAlertSource } from './saved-searches';

/**
 * MATCH-ALERT RESULTS, FOR STAFF (2026-11-03, owner-approved). Analytics and
 * Exports. docs/DECISIONS.md, "Match-alert results report".
 *
 * Did the match alerts lead anywhere? For a window of Juba days: how many
 * were sent (in the app, by SMS), how many were opened, how many led to a
 * conversation between the alerted person and the poster within 7 days, and
 * how many to a completed deal between them within 30 days. Counts and rates
 * only: no person, post or message is ever named.
 *
 * The SQL (apps/web/lib/api/match-alert-report.ts) counts per Juba day and
 * source; everything below -- periods, totals, rates -- is pure and tested.
 */

/** Days after an alert in which a conversation between the two people counts. */
export const ALERT_CONVERSATION_DAYS = 7;
/** Days after an alert in which a completed deal between the two people counts. */
export const ALERT_DEAL_DAYS = 30;

export const MATCH_ALERT_SOURCE_LABELS: Readonly<Record<MatchAlertSource, string>> = {
  buying_request_match: 'Buying-request match',
  listing_match: 'Listing match',
  saved_search: 'Saved search',
};

export const MATCH_ALERT_REPORT_MESSAGES = {
  productLength: 'A product is 2 to 80 characters.',
  sourceUnknown: 'Choose an alert source from the list.',
} as const;

const M = MATCH_ALERT_REPORT_MESSAGES;

/**
 * GET /api/analytics/match-alerts (query) and POST .../export (`filters`).
 * The window, state and commodity follow the analytics page's own rules and
 * sentences (analyticsFilterSchema); product and source are this report's.
 */
const text = (message: string) => z.string({ error: () => message }).optional();

export const matchAlertReportFilterSchema = z
  .strictObject({
    from: text(ANALYTICS_MESSAGES.dateInvalid),
    to: text(ANALYTICS_MESSAGES.dateInvalid),
    state_id: text(ANALYTICS_MESSAGES.stateInvalid),
    commodity: text(ANALYTICS_MESSAGES.commodityInvalid),
    product: z
      .string({ error: () => M.productLength })
      .trim()
      .min(2, M.productLength)
      .max(80, M.productLength)
      .optional(),
    source: z.enum(MATCH_ALERT_SOURCES, { error: () => M.sourceUnknown }).optional(),
  })
  .superRefine((f, ctx) => {
    const shared = analyticsFilterSchema.safeParse(windowPart(f));
    if (!shared.success) {
      for (const issue of shared.error.issues) {
        ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
      }
    }
  })
  .transform((f) => ({
    ...analyticsFilterSchema.parse(windowPart(f)),
    ...(f.product !== undefined ? { product: f.product } : {}),
    ...(f.source !== undefined ? { source: f.source } : {}),
  }));
export type MatchAlertReportFilter = z.input<typeof matchAlertReportFilterSchema>;
export type MatchAlertReportQuery = z.output<typeof matchAlertReportFilterSchema>;

/** The window, state and commodity: checked by the analytics page's own schema. */
function windowPart(f: { from?: string; to?: string; state_id?: string; commodity?: string }) {
  return {
    ...(f.from !== undefined ? { from: f.from } : {}),
    ...(f.to !== undefined ? { to: f.to } : {}),
    ...(f.state_id !== undefined ? { state_id: f.state_id } : {}),
    ...(f.commodity !== undefined ? { commodity: f.commodity } : {}),
  };
}

export const matchAlertExportSchema = z.strictObject({
  filters: matchAlertReportFilterSchema.optional(),
});

/** One Juba day and source, as the SQL counts it. */
export interface MatchAlertDayRow {
  /** YYYY-MM-DD, Juba. */
  day: string;
  source: MatchAlertSource;
  /** Alerts recorded (marketing_notice rows). */
  sent: number;
  /** Of them, stored as an in-app notice. */
  in_app: number;
  /** Of them, an SMS the provider accepted (recorded since migration 20261103100000). */
  sms: number;
  /** Of the in-app notices, read (notification.read_at set) by now. */
  read: number;
  /** Alerts followed by a conversation between the two people within 7 days. */
  conversations: number;
  /** Alerts whose 7 days are over (the conversation rate's denominator). */
  conversation_due: number;
  /** Of those, followed by a conversation. */
  conversation_due_hit: number;
  /** Alerts followed by a completed deal between the two people within 30 days. */
  deals: number;
  /** Alerts whose 30 days are over (the deal rate's denominator). */
  deal_due: number;
  /** Of those, followed by a completed deal. */
  deal_due_hit: number;
}

const COUNT_FIELDS = [
  'sent',
  'in_app',
  'sms',
  'read',
  'conversations',
  'conversation_due',
  'conversation_due_hit',
  'deals',
  'deal_due',
  'deal_due_hit',
] as const;
type CountField = (typeof COUNT_FIELDS)[number];
export type MatchAlertCounts = Record<CountField, number>;

export interface MatchAlertRates {
  /** Opened, of in-app notices sent. Percent, one decimal; null when nothing was sent. */
  read_rate: number | null;
  /** A conversation within 7 days, of alerts whose 7 days are over. */
  conversation_rate: number | null;
  /** A completed deal within 30 days, of alerts whose 30 days are over. */
  deal_rate: number | null;
}

export interface MatchAlertSourceLine extends MatchAlertCounts, MatchAlertRates {
  source: MatchAlertSource;
  label: string;
}

export interface MatchAlertTrend {
  bucket: AnalyticsBucket;
  periods: string[];
  sent: number[];
  conversations: number[];
  deals: number[];
}

export interface MatchAlertReport {
  window: { from: string; to: string; days: number; time_zone: string };
  filters: {
    state_id: string | null;
    commodity: string | null;
    product: string | null;
    source: MatchAlertSource | null;
  };
  scope_states: string[] | null;
  generated_at: string;
  /** Null when the database has no match alerts table yet (not measured, never 0). */
  totals: (MatchAlertCounts & MatchAlertRates) | null;
  by_source: MatchAlertSourceLine[];
  trend: MatchAlertTrend;
  limitations: readonly string[];
}

const zero = (): MatchAlertCounts =>
  Object.fromEntries(COUNT_FIELDS.map((k) => [k, 0])) as MatchAlertCounts;

/** A share as a percent with one decimal, or null when the denominator is 0. */
export function ratePercent(part: number, whole: number): number | null {
  if (!(whole > 0)) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export function ratesOf(c: MatchAlertCounts): MatchAlertRates {
  return {
    read_rate: ratePercent(c.read, c.in_app),
    conversation_rate: ratePercent(c.conversation_due_hit, c.conversation_due),
    deal_rate: ratePercent(c.deal_due_hit, c.deal_due),
  };
}

function add(into: MatchAlertCounts, row: Partial<MatchAlertCounts>): void {
  for (const k of COUNT_FIELDS) into[k] += Number(row[k] ?? 0);
}

const addDays = (date: string, days: number): string =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

/** The first day of the period a Juba day falls in (weeks start Monday, as bucketStarts). */
export function periodStartOf(day: string, bucket: AnalyticsBucket): string {
  if (bucket === 'day') return day;
  if (bucket === 'month') return `${day.slice(0, 7)}-01`;
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

/**
 * The report from the day rows: totals with their rates, one line per source
 * (every source, zeros included, in a fixed order), and the trend over the
 * window's periods. A row outside the window or of an unknown source is
 * ignored rather than miscounted.
 */
export function buildMatchAlertFunnel(
  rows: readonly MatchAlertDayRow[],
  window: Pick<AnalyticsWindow, 'from' | 'to' | 'days'>,
): Pick<MatchAlertReport, 'totals' | 'by_source' | 'trend'> {
  const bucket = analyticsBucket(window.days);
  const periods = bucketStarts(window, bucket);
  const at = new Map(periods.map((p, i) => [p, i]));
  const totals = zero();
  const bySource = new Map<MatchAlertSource, MatchAlertCounts>(
    MATCH_ALERT_SOURCES.map((s) => [s, zero()]),
  );
  const trend: MatchAlertTrend = {
    bucket,
    periods,
    sent: periods.map(() => 0),
    conversations: periods.map(() => 0),
    deals: periods.map(() => 0),
  };
  for (const row of rows) {
    if (row.day < window.from || row.day > window.to) continue;
    const line = bySource.get(row.source);
    if (!line) continue;
    add(line, row);
    add(totals, row);
    const i = at.get(periodStartOf(row.day, bucket));
    if (i === undefined) continue;
    trend.sent[i]! += Number(row.sent);
    trend.conversations[i]! += Number(row.conversations);
    trend.deals[i]! += Number(row.deals);
  }
  return {
    totals: { ...totals, ...ratesOf(totals) },
    by_source: MATCH_ALERT_SOURCES.map((source) => {
      const c = bySource.get(source)!;
      return { source, label: MATCH_ALERT_SOURCE_LABELS[source], ...c, ...ratesOf(c) };
    }),
    trend,
  };
}

// ---------------------------------------------------------------------------
// THE DEFINITIONS: shown on the page and in the workbook (spec, "Define the
// date window, denominator and data source for each metric").
// ---------------------------------------------------------------------------

export interface MatchAlertMetricDefinition {
  readonly id: string;
  readonly label: string;
  readonly definition: string;
  readonly denominator: string;
  readonly source: string;
  readonly window: string;
}

const IN_WINDOW = 'Alerts sent on a Juba day inside the window.';

export const MATCH_ALERT_METRICS: readonly MatchAlertMetricDefinition[] = [
  {
    id: 'sent',
    label: 'Alerts sent',
    definition:
      'Match alerts recorded: one per person per post, whatever the channel. A person matched ' +
      'both by what they sell or want and by a saved search is one alert, counted under the ' +
      'first (the activity match).',
    denominator: 'None: a count.',
    source: 'marketing_notice (kind match), joined to the produce listing or buying request',
    window: IN_WINDOW,
  },
  {
    id: 'in_app',
    label: 'Sent in the app',
    definition: 'Alerts stored as an in-app notice for the person.',
    denominator: 'None: a count.',
    source: 'marketing_notice.notification_id',
    window: IN_WINDOW,
  },
  {
    id: 'sms',
    label: 'Sent by SMS',
    definition:
      'Alerts also sent by SMS (the person switched SMS match alerts on) and accepted by the ' +
      'SMS provider. Recorded from migration 20261103100000 onwards; earlier SMS are not counted.',
    denominator: 'None: a count.',
    source: 'marketing_notice.sms_sent_at',
    window: IN_WINDOW,
  },
  {
    id: 'read',
    label: 'Opened',
    definition:
      'In-app alerts the person has opened or marked read, by the time the report is made. For ' +
      'an email account the notice is shared by its organisation, so any member reading it counts.',
    denominator: 'Sent in the app.',
    source: 'notification.read_at',
    window: `${IN_WINDOW} Read at any time up to now.`,
  },
  {
    id: 'conversations',
    label: 'Conversations started within 7 days',
    definition:
      'Alerts after which the alerted person and the poster started a conversation (either of ' +
      'them starting it, about any post) within 7 days of the alert.',
    denominator:
      'For the rate: alerts whose 7 days are over (sent at least 7 days before the report is ' +
      'made); the count includes newer alerts that already led to one.',
    source: 'conversation (owner and starter sign-ins, created_at)',
    window: `${IN_WINDOW} Conversation from the alert to 7 days after it.`,
  },
  {
    id: 'deals',
    label: 'Deals completed within 30 days',
    definition:
      'Alerts after which, within 30 days, the post was recorded completed or a sale was ' +
      'recorded on it (listing completed, or sold, or a sale; buying request completed) after a ' +
      'conversation about that post between the alerted person and the poster, or an order by ' +
      "the alerted person's organisation on that listing was delivered or completed. Completion " +
      'is self-reported by the owner unless it is a delivered order.',
    denominator:
      'For the rate: alerts whose 30 days are over; the count includes newer alerts that ' +
      'already led to one.',
    source:
      'audit_event (listing.status_changed to completed or sold, or a sale) and conversation; ' +
      'purchase_order with delivery_update (delivered, completed)',
    window: `${IN_WINDOW} Completion from the alert to 30 days after it.`,
  },
];

/** What the report cannot show. On the page, in the print and in the workbook. */
export const MATCH_ALERT_LIMITATIONS: readonly string[] = [
  'Counts only. No person, post, product name or message is shown or exported.',
  'An alert is counted once per person per post. A person matched both by activity and by a ' +
    'saved search is counted under the activity match.',
  'Alerts made before migration 20261103100000 carry no source of their own; they are counted ' +
    'as a buying-request or a listing match from the kind of post, which is what they were.',
  'SMS sends are recorded from migration 20261103100000 onwards.',
  'A conversation or a deal shows that the two people went on to talk or trade, not that the ' +
    'alert caused it.',
  'Completed deals are self-reported by the post owner, except delivered orders.',
  'The state, commodity and product filters are the post’s, not the alerted person’s.',
  'Rates over periods whose 7 or 30 days are not yet over are left out of the rate denominators.',
];
