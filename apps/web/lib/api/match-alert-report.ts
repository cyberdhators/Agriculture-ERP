import {
  ALERT_CONVERSATION_DAYS,
  ALERT_DEAL_DAYS,
  type AnalyticsWindow,
  DISPLAY_TIME_ZONE,
  MATCH_ALERT_LIMITATIONS,
  type MatchAlertDayRow,
  type MatchAlertReport,
  type MatchAlertReportQuery,
  buildMatchAlertFunnel,
  toIso,
} from '@agri-erp/shared';
import { type Prisma } from '@prisma/client';

import { inlineAnalyticsQuery } from './analytics';

/**
 * MATCH-ALERT RESULTS, THE QUERY (2026-11-03). docs/DECISIONS.md,
 * "Match-alert results report". Definitions: MATCH_ALERT_METRICS in
 * packages/shared/src/match-alert-report.ts; the totals, rates and trend are
 * worked out there from the rows this returns.
 *
 * ONE STATEMENT, COUNTS ONLY. It counts per Juba day and alert source; no
 * row it returns names a person, a post or a product, and no message text is
 * read. The alerted person and the poster are compared inside the database
 * and never leave it.
 *
 * Parameters, through one CTE `w` as the analytics queries do: the window
 * (s, e), the states (st, NULL for national), the commodity (cm), a product
 * word (pr) and the source (src), NULL when not chosen; and the report's
 * clock (n), so "whose 7 days are over" is measured against one instant.
 *
 * TABLES THAT MAY NOT EXIST YET. Without marketing_notice (migration
 * 20261101090000) there is nothing to count: the report says "not measured".
 * Without the source and SMS columns (20261103100000) an alert's source is
 * read from its post's kind and no SMS is counted. Without purchase orders
 * only the self-reported completions count as deals.
 */

type Db = { $queryRawUnsafe: Prisma.TransactionClient['$queryRawUnsafe'] };

interface Present {
  marketingNotice: boolean;
  sources: boolean;
  conversation: boolean;
  orders: boolean;
}

async function present(db: Db): Promise<Present> {
  const [row] = await db.$queryRawUnsafe<
    {
      marketing_notice: boolean;
      sources: boolean;
      conversation: boolean;
      orders: boolean;
    }[]
  >(
    `SELECT to_regclass('public.marketing_notice') IS NOT NULL AS marketing_notice,
            EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'marketing_notice'
                       AND column_name = 'sms_sent_at') AS sources,
            to_regclass('public.conversation') IS NOT NULL AS conversation,
            (to_regclass('public.purchase_order') IS NOT NULL
             AND to_regclass('public.delivery_update') IS NOT NULL) AS orders`,
  );
  return {
    marketingNotice: row?.marketing_notice === true,
    sources: row?.sources === true,
    conversation: row?.conversation === true,
    orders: row?.orders === true,
  };
}

/** The two people, either way round, in a conversation `c`. */
const BETWEEN = (c: string) =>
  `((${c}.owner_auth_user_id = a.poster AND ${c}.starter_auth_user_id = a.auth_user_id)
     OR (${c}.owner_auth_user_id = a.auth_user_id AND ${c}.starter_auth_user_id = a.poster))`;

/** The statement, for what this database has. Exported for the scan test. */
export function matchAlertReportSql(p: Present): string {
  const source = p.sources
    ? `COALESCE(m.source, CASE m.post_kind WHEN 'buying_request' THEN 'buying_request_match'
                                          ELSE 'listing_match' END)`
    : `CASE m.post_kind WHEN 'buying_request' THEN 'buying_request_match' ELSE 'listing_match' END`;
  const smsAt = p.sources ? 'm.sms_sent_at' : 'NULL::timestamptz';
  const conversation = p.conversation
    ? `SELECT min(c.created_at) AS at FROM public.conversation c
        WHERE a.poster IS NOT NULL
          AND c.created_at >= a.created_at
          AND c.created_at < a.created_at + interval '${ALERT_CONVERSATION_DAYS} days'
          AND ${BETWEEN('c')}`
    : 'SELECT NULL::timestamptz AS at';
  const completed = p.conversation
    ? `SELECT ae.occurred_at AS at FROM public.audit_event ae
        WHERE ae.entity_type IN ('produce_listing', 'buying_request')
          AND ae.entity_id = a.post_id::text
          AND (ae.after ->> 'status' IN ('completed', 'sold')
               OR ae.after ->> 'sale_quantity' IS NOT NULL)
          AND ae.occurred_at >= a.created_at
          AND ae.occurred_at < a.created_at + interval '${ALERT_DEAL_DAYS} days'
          AND a.poster IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.conversation c2
                       WHERE c2.post_kind = a.post_kind AND c2.post_id = a.post_id
                         AND c2.created_at >= a.created_at AND c2.created_at <= ae.occurred_at
                         AND ${BETWEEN('c2')})`
    : `SELECT NULL::timestamptz AS at WHERE false`;
  const ordered = p.orders
    ? `UNION ALL
       SELECT du.occurred_at FROM public.purchase_order po
         JOIN public.delivery_update du ON du.order_id = po.id
        WHERE a.post_kind = 'listing' AND po.listing_id = a.post_id AND po.deleted_at IS NULL
          AND du.status::text IN ('delivered', 'completed')
          AND du.occurred_at >= a.created_at
          AND du.occurred_at < a.created_at + interval '${ALERT_DEAL_DAYS} days'
          AND EXISTS (SELECT 1 FROM public.buyer bo
                       WHERE bo.organization_id = po.organization_id
                         AND bo.auth_user_id = a.auth_user_id)`
    : '';
  const due = (days: number) => `a.created_at <= w.n - interval '${days} days'`;
  return `WITH w AS (SELECT $1::timestamptz AS s, $2::timestamptz AS e, $3::text[] AS st,
                          $4::text AS cm, $5::text AS pr, $6::text AS src, $7::timestamptz AS n),
a AS (
  SELECT m.id, m.auth_user_id, m.created_at, m.post_kind, m.post_id, m.notification_id,
         ${smsAt} AS sms_sent_at, ${source} AS source, post.poster
    FROM public.marketing_notice m CROSS JOIN w
    JOIN LATERAL (
      SELECT pl.state_id, pl.category::text AS category, pl.product_name,
             (SELECT fx.auth_user_id FROM public.farmer fx WHERE fx.id = pl.farmer_id) AS poster
        FROM public.produce_listing pl
       WHERE m.post_kind = 'listing' AND pl.id = m.post_id
      UNION ALL
      SELECT br.state_id, br.category::text, br.product_name,
             COALESCE((SELECT fx.auth_user_id FROM public.farmer fx WHERE fx.id = br.farmer_id),
                      (SELECT bx.auth_user_id FROM public.buyer bx WHERE bx.id = br.buyer_id))
        FROM public.buying_request br
       WHERE m.post_kind = 'buying_request' AND br.id = m.post_id
    ) post ON true
   WHERE m.kind = 'match' AND m.created_at >= w.s AND m.created_at < w.e
     AND (w.st IS NULL OR post.state_id = ANY(w.st))
     AND (w.cm IS NULL OR post.category = w.cm)
     AND (w.pr IS NULL OR post.product_name ILIKE '%' || w.pr || '%')
     AND (w.src IS NULL OR ${source} = w.src)
)
SELECT to_char((a.created_at AT TIME ZONE '${DISPLAY_TIME_ZONE}')::date, 'YYYY-MM-DD') AS day,
       a.source,
       count(*)::int AS sent,
       count(*) FILTER (WHERE a.notification_id IS NOT NULL)::int AS in_app,
       count(*) FILTER (WHERE a.sms_sent_at IS NOT NULL)::int AS sms,
       count(*) FILTER (WHERE a.notification_id IS NOT NULL AND n.read_at IS NOT NULL)::int AS read,
       count(*) FILTER (WHERE conv.at IS NOT NULL)::int AS conversations,
       count(*) FILTER (WHERE ${due(ALERT_CONVERSATION_DAYS)})::int AS conversation_due,
       count(*) FILTER (WHERE ${due(ALERT_CONVERSATION_DAYS)} AND conv.at IS NOT NULL)::int
         AS conversation_due_hit,
       count(*) FILTER (WHERE deal.at IS NOT NULL)::int AS deals,
       count(*) FILTER (WHERE ${due(ALERT_DEAL_DAYS)})::int AS deal_due,
       count(*) FILTER (WHERE ${due(ALERT_DEAL_DAYS)} AND deal.at IS NOT NULL)::int AS deal_due_hit
  FROM a CROSS JOIN w
  LEFT JOIN public.notification n ON n.id = a.notification_id AND n.deleted_at IS NULL
  LEFT JOIN LATERAL (${conversation}) conv ON true
  LEFT JOIN LATERAL (
    SELECT min(x.at) AS at FROM (${completed} ${ordered}) x
  ) deal ON true
 GROUP BY 1, 2
 ORDER BY 1, 2`;
}

export interface MatchAlertRun {
  readonly report: MatchAlertReport;
  /** The statement as it ran, parameters inlined, for the export record. */
  readonly query: string;
}

/**
 * The report for one window, limited to `states` (null: national). The
 * caller has already decided `states` from the role and the permission.
 */
export async function matchAlertReport(
  db: Db,
  window: AnalyticsWindow,
  states: readonly string[] | null,
  filter: Pick<MatchAlertReportQuery, 'state_id' | 'commodity' | 'product' | 'source'>,
  now: Date = new Date(),
): Promise<MatchAlertRun> {
  const has = await present(db);
  const base = {
    window: { from: window.from, to: window.to, days: window.days, time_zone: DISPLAY_TIME_ZONE },
    filters: {
      state_id: filter.state_id ?? null,
      commodity: filter.commodity ?? null,
      product: filter.product ?? null,
      source: filter.source ?? null,
    },
    scope_states: states ? [...states] : null,
    generated_at: toIso(now),
    limitations: MATCH_ALERT_LIMITATIONS,
  };
  if (!has.marketingNotice) {
    const empty = buildMatchAlertFunnel([], window);
    return { report: { ...base, ...empty, totals: null }, query: '-- marketing_notice absent' };
  }
  const sql = matchAlertReportSql(has);
  // The product filter is a plain word: LIKE's own characters are taken out.
  const product = filter.product ? filter.product.replace(/[\\%_]/g, '') : null;
  const params = [
    window.startsAt,
    window.endsAt,
    states ? [...states] : null,
    filter.commodity ?? null,
    product || null,
    filter.source ?? null,
    now,
  ];
  const rows = await db.$queryRawUnsafe<MatchAlertDayRow[]>(sql, ...params);
  return {
    report: { ...base, ...buildMatchAlertFunnel(rows, window) },
    query: inlineAnalyticsQuery(sql, params),
  };
}
