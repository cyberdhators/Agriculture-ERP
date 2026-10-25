import {
  ANALYTICS_LIMITATIONS,
  ANALYTICS_METRICS,
  type AnalyticsMetricValue,
  type AnalyticsSummary,
  type AnalyticsWindow,
  DISPLAY_TIME_ZONE,
  toIso,
} from '@agri-erp/shared';
import { type Prisma } from '@prisma/client';

/**
 * MARKETPLACE AND ACCOUNT ANALYTICS, THE QUERIES (2026-10-22).
 *
 * One builder serves GET /api/analytics/summary and POST /api/analytics/export,
 * so a figure on the page and the same figure in the Excel file agree. Every
 * figure is declared in packages/shared/src/analytics.ts (what it counts, over
 * what, from where) and computed here by the SQL keyed to the same id; a test
 * holds the two lists equal.
 *
 * EVERY QUERY TAKES THE SAME THREE PARAMETERS, through one CTE `w`: the
 * window's first instant (s), the instant after its last day (e), both at
 * Juba midnight, and the states to limit to (st, NULL for national). So the
 * export log can record each query with its parameters inlined, and no query
 * can quietly use a different window from its neighbours.
 *
 * Counts only. No query selects a name, a phone number or a message body:
 * phone numbers are counted DISTINCT inside the database and never leave it.
 * Soft-deleted rows are excluded in every query that has them.
 *
 * TABLES THAT MAY NOT EXIST YET. Several tables come from migrations that
 * another session applies (production is the only database). Their presence
 * is asked first; a figure whose table is missing is served as null with
 * `not_in_database`, never as zero and never as a failed page.
 */

type Db = { $queryRawUnsafe: Prisma.TransactionClient['$queryRawUnsafe'] };

const W = `WITH w AS (SELECT $1::timestamptz AS s, $2::timestamptz AS e, $3::text[] AS st)`;

/** Every account that can sign in, with its state; soft-deleted accounts are not here. */
const P = `p AS (
  SELECT 'farmer'::text AS kind, f.id, f.state_id, f.auth_user_id
    FROM public.farmer f WHERE f.deleted_at IS NULL
  UNION ALL
  SELECT 'buyer', b.id, o.state_id, b.auth_user_id
    FROM public.buyer b JOIN public.buyer_organization o ON o.id = b.organization_id
   WHERE b.deleted_at IS NULL AND o.deleted_at IS NULL
  UNION ALL
  SELECT 'officer', x.id, x.state_id, x.auth_user_id
    FROM public.officer x WHERE x.deleted_at IS NULL
  UNION ALL
  SELECT 'user', u.id, u.scope_state_id, u.auth_user_id
    FROM public."user" u WHERE u.deleted_at IS NULL
)`;

const inWindow = (column: string) => `${column} >= w.s AND ${column} < w.e`;
const inStates = (column: string) => `(w.st IS NULL OR ${column} = ANY(w.st))`;

/** The state of the post a conversation is about. */
const POST_STATE = `CASE c.post_kind
  WHEN 'listing' THEN (SELECT pl.state_id FROM public.produce_listing pl WHERE pl.id = c.post_id)
  WHEN 'buying_request' THEN (SELECT pb.state_id FROM public.buying_request pb WHERE pb.id = c.post_id)
  WHEN 'service' THEN (SELECT ps.state_id FROM public.service_listing ps WHERE ps.id = c.post_id)
END`;

const SIGNED_IN = `('first_sign_in', 'sign_in', 'return_session')`;
const ACCESS_JOIN = `public.access_log a JOIN p ON p.kind = a.principal_kind AND p.id = a.principal_id CROSS JOIN w`;

/** Account holders: a sign-in account with a live farmer or buyer record, and its state(s). */
const H = `h AS (
  SELECT ap.auth_user_id, ap.activities, ap.profile_kind,
         f.state_id AS farmer_state, o.state_id AS buyer_state
    FROM public.account_profile ap
    LEFT JOIN public.farmer f ON f.auth_user_id = ap.auth_user_id AND f.deleted_at IS NULL
    LEFT JOIN public.buyer b ON b.auth_user_id = ap.auth_user_id AND b.deleted_at IS NULL
    LEFT JOIN public.buyer_organization o ON o.id = b.organization_id AND o.deleted_at IS NULL
   WHERE f.id IS NOT NULL OR o.id IS NOT NULL
)`;
const H_STATES = `(w.st IS NULL OR h.farmer_state = ANY(w.st) OR h.buyer_state = ANY(w.st))`;

/** 2026-10-27: the same account holders with their enterprise size (a column migration 20261027100000 adds). */
const H_SIZED = H.replace('ap.profile_kind,', 'ap.profile_kind, ap.enterprise_size,');

/**
 * Advice cases rated in the window: the feedback audit row says when (a case
 * carries no feedback time), the case the rating. Once per case by design;
 * DISTINCT keeps it so. Soft-deleted cases are out.
 */
const ADVICE_RATED = `rated AS (
  SELECT DISTINCT ac.id, ac.feedback_rating
    FROM public.audit_event ae
    JOIN public.advice_case ac ON ac.id::text = ae.entity_id CROSS JOIN w
   WHERE ae.entity_type = 'advice_case' AND ae.action = 'advice_case.feedback'
     AND ${inWindow('ae.occurred_at')} AND ac.deleted_at IS NULL
     AND ac.feedback_rating IS NOT NULL AND w.st IS NULL
)`;

interface MetricSql {
  /** Tables (or `table.column`) the queries read that a pending migration creates. */
  readonly needs: readonly string[];
  /** False: the rows carry no state, so the figure is national only. */
  readonly located: boolean;
  /** Returns one row `{ value }`. Omitted: the total is the sum of the breakdown. */
  readonly total?: string;
  /** Returns rows `{ key, value }` and optionally `label`. */
  readonly breakdown?: string;
}

/**
 * The SQL for each figure, keyed by the id in ANALYTICS_METRICS. Read beside
 * that list: the sentence there is what this query must count.
 */
export const METRIC_SQL: Readonly<Record<string, MetricSql>> = {
  'accounts.new': {
    needs: ['access_log'],
    located: true,
    total: `${W}, ${P}
      SELECT count(DISTINCT p.auth_user_id)::int AS value FROM ${ACCESS_JOIN}
       WHERE a.event = 'account_created' AND a.principal_kind IN ('farmer', 'buyer')
         AND ${inWindow('a.occurred_at')} AND ${inStates('p.state_id')}`,
    breakdown: `${W}, ${P}
      SELECT p.kind AS key, count(DISTINCT p.auth_user_id)::int AS value FROM ${ACCESS_JOIN}
       WHERE a.event = 'account_created' AND a.principal_kind IN ('farmer', 'buyer')
         AND ${inWindow('a.occurred_at')} AND ${inStates('p.state_id')}
       GROUP BY 1 ORDER BY 1`,
  },
  'farmers.registered': {
    needs: [],
    located: true,
    breakdown: `${W}
      SELECT f.registration_source::text AS key, count(*)::int AS value
        FROM public.farmer f CROSS JOIN w
       WHERE f.deleted_at IS NULL AND ${inWindow('f.created_at')} AND ${inStates('f.state_id')}
       GROUP BY 1 ORDER BY 1`,
  },
  'farmers.verified': {
    needs: [],
    located: true,
    total: `${W}
      SELECT count(DISTINCT v.farmer_id)::int AS value
        FROM public.verification_event v
        JOIN public.farmer_verified_v f ON f.id = v.farmer_id CROSS JOIN w
       WHERE v.decision = 'verified' AND ${inWindow('v.decided_at')} AND ${inStates('f.state_id')}`,
  },
  'farmers.rejected': {
    needs: [],
    located: true,
    total: `${W}
      SELECT count(DISTINCT v.farmer_id)::int AS value
        FROM public.verification_event v
        JOIN public.farmer f ON f.id = v.farmer_id AND f.deleted_at IS NULL CROSS JOIN w
       WHERE v.decision = 'rejected' AND ${inWindow('v.decided_at')} AND ${inStates('f.state_id')}`,
  },
  'farmers.pending_now': {
    needs: [],
    located: true,
    total: `${W}
      SELECT count(*)::int AS value FROM public.farmer f CROSS JOIN w
       WHERE f.deleted_at IS NULL AND f.verification_status = 'pending' AND ${inStates('f.state_id')}`,
  },
  'buyers.registered': {
    needs: ['buyer_organization'],
    located: true,
    breakdown: `${W}
      SELECT o.account_type::text AS key, count(*)::int AS value
        FROM public.buyer_organization o CROSS JOIN w
       WHERE o.deleted_at IS NULL AND ${inWindow('o.created_at')} AND ${inStates('o.state_id')}
       GROUP BY 1 ORDER BY 1`,
  },
  'buyers.verified': {
    needs: ['buyer_organization'],
    located: true,
    total: `${W}
      SELECT count(*)::int AS value FROM public.buyer_organization o CROSS JOIN w
       WHERE o.deleted_at IS NULL AND o.account_type = 'business'
         AND o.verification_status = 'verified' AND ${inWindow('o.verified_at')}
         AND ${inStates('o.state_id')}`,
  },
  'onboarding.phones_started': {
    needs: ['phone_verification'],
    located: false,
    total: `${W}
      SELECT count(DISTINCT pv.phone)::int AS value FROM public.phone_verification pv CROSS JOIN w
       WHERE pv.purpose = 'farmer_sign_up' AND ${inWindow('pv.created_at')} AND w.st IS NULL`,
  },
  'onboarding.phones_confirmed': {
    needs: ['phone_verification'],
    located: false,
    total: `${W}
      SELECT count(DISTINCT pv.phone)::int AS value FROM public.phone_verification pv CROSS JOIN w
       WHERE pv.purpose = 'farmer_sign_up' AND pv.verified_at IS NOT NULL
         AND ${inWindow('pv.created_at')} AND w.st IS NULL`,
  },
  'access.first_sign_ins': {
    needs: ['access_log'],
    located: true,
    breakdown: `${W}, ${P}
      SELECT a.principal_kind AS key, count(DISTINCT a.principal_id)::int AS value FROM ${ACCESS_JOIN}
       WHERE a.event = 'first_sign_in' AND ${inWindow('a.occurred_at')} AND ${inStates('p.state_id')}
       GROUP BY 1 ORDER BY 1`,
  },
  'access.active': {
    needs: ['access_log'],
    located: true,
    breakdown: `${W}, ${P}
      SELECT a.principal_kind AS key, count(DISTINCT a.principal_id)::int AS value FROM ${ACCESS_JOIN}
       WHERE a.event IN ${SIGNED_IN} AND ${inWindow('a.occurred_at')} AND ${inStates('p.state_id')}
       GROUP BY 1 ORDER BY 1`,
  },
  'access.returning': {
    needs: ['access_log'],
    located: true,
    breakdown: `${W}, ${P}
      SELECT a.principal_kind AS key, count(DISTINCT a.principal_id)::int AS value FROM ${ACCESS_JOIN}
       WHERE a.event IN ${SIGNED_IN} AND ${inWindow('a.occurred_at')} AND ${inStates('p.state_id')}
         AND NOT EXISTS (
           SELECT 1 FROM public.access_log f1
            WHERE f1.principal_kind = a.principal_kind AND f1.principal_id = a.principal_id
              AND f1.event = 'first_sign_in' AND ${inWindow('f1.occurred_at')})
       GROUP BY 1 ORDER BY 1`,
  },
  'access.sessions': {
    needs: ['access_log'],
    located: true,
    breakdown: `${W}, ${P}
      SELECT a.event AS key, count(*)::int AS value FROM ${ACCESS_JOIN}
       WHERE a.event IN ${SIGNED_IN} AND ${inWindow('a.occurred_at')} AND ${inStates('p.state_id')}
       GROUP BY 1 ORDER BY 1`,
  },
  'participation.by_state': {
    needs: ['access_log'],
    located: true,
    breakdown: `${W}, ${P}
      SELECT COALESCE(p.state_id, 'none') AS key, max(s.name) AS label,
             count(DISTINCT p.kind || ':' || p.id::text)::int AS value
        FROM ${ACCESS_JOIN} LEFT JOIN public.state s ON s.id = p.state_id
       WHERE a.principal_kind IN ('farmer', 'buyer') AND a.event IN ${SIGNED_IN}
         AND ${inWindow('a.occurred_at')} AND ${inStates('p.state_id')}
       GROUP BY 1 ORDER BY 3 DESC, 1`,
  },
  'participation.activities': {
    needs: ['account_profile'],
    located: true,
    total: `${W}, ${H}
      SELECT count(*)::int AS value FROM h CROSS JOIN w
       WHERE cardinality(h.activities) > 0 AND ${H_STATES}`,
    breakdown: `${W}, ${H}
      SELECT act AS key, count(*)::int AS value
        FROM h CROSS JOIN w CROSS JOIN LATERAL unnest(h.activities) AS act
       WHERE ${H_STATES}
       GROUP BY 1 ORDER BY 2 DESC, 1`,
  },
  'participation.profile_kinds': {
    needs: ['account_profile'],
    located: true,
    breakdown: `${W}, ${H}
      SELECT h.profile_kind AS key, count(*)::int AS value FROM h CROSS JOIN w
       WHERE ${H_STATES}
       GROUP BY 1 ORDER BY 1`,
  },
  // 2026-10-27: SME is a size, not a kind of business. Groups, businesses and
  // institutions only; an unstated size counts as not_stated.
  'participation.enterprise_sizes': {
    needs: ['account_profile', 'account_profile.enterprise_size'],
    located: true,
    breakdown: `${W}, ${H_SIZED}
      SELECT COALESCE(h.enterprise_size, 'not_stated') AS key, count(*)::int AS value
        FROM h CROSS JOIN w
       WHERE h.profile_kind <> 'individual' AND ${H_STATES}
       GROUP BY 1 ORDER BY 1`,
  },
  'listings.created': {
    needs: [],
    located: true,
    total: `${W}
      SELECT count(*)::int AS value FROM public.produce_listing l CROSS JOIN w
       WHERE l.deleted_at IS NULL AND ${inWindow('l.created_at')} AND ${inStates('l.state_id')}`,
  },
  'listings.active_now': {
    needs: [],
    located: true,
    total: `${W}
      SELECT count(*)::int AS value FROM public.produce_listing l CROSS JOIN w
       WHERE l.deleted_at IS NULL AND l.status::text = 'listed' AND ${inStates('l.state_id')}`,
  },
  'listings.completed': {
    needs: [],
    located: true,
    total: `${W}
      SELECT count(DISTINCT l.id)::int AS value
        FROM public.audit_event ae
        JOIN public.produce_listing l ON l.id::text = ae.entity_id CROSS JOIN w
       WHERE ae.entity_type = 'produce_listing' AND ae.action = 'listing.status_changed'
         AND ae.after ->> 'status' IN ('completed', 'sold') AND ${inWindow('ae.occurred_at')}
         AND l.deleted_at IS NULL AND l.status::text IN ('completed', 'sold')
         AND ${inStates('l.state_id')}`,
  },
  'trades.sales_recorded': {
    needs: [],
    located: true,
    total: `${W}
      SELECT count(*)::int AS value
        FROM public.audit_event ae
        JOIN public.produce_listing l ON l.id::text = ae.entity_id CROSS JOIN w
       WHERE ae.entity_type = 'produce_listing' AND ae.after ->> 'sale_quantity' IS NOT NULL
         AND ${inWindow('ae.occurred_at')} AND l.deleted_at IS NULL AND ${inStates('l.state_id')}`,
  },
  'trades.orders_delivered': {
    needs: ['purchase_order'],
    located: true,
    total: `${W}
      SELECT count(DISTINCT po.id)::int AS value
        FROM public.delivery_update du
        JOIN public.purchase_order po ON po.id = du.order_id AND po.deleted_at IS NULL
        JOIN public.produce_listing l ON l.id = po.listing_id CROSS JOIN w
       WHERE du.status::text IN ('delivered', 'completed') AND ${inWindow('du.occurred_at')}
         AND ${inStates('l.state_id')}`,
  },
  'orders.created': {
    needs: ['purchase_order'],
    located: true,
    total: `${W}
      SELECT count(*)::int AS value
        FROM public.purchase_order po
        JOIN public.produce_listing l ON l.id = po.listing_id CROSS JOIN w
       WHERE po.deleted_at IS NULL AND ${inWindow('po.created_at')} AND ${inStates('l.state_id')}`,
  },
  'purchase_requests.sent': {
    needs: ['purchase_request'],
    located: true,
    total: `${W}
      SELECT count(*)::int AS value
        FROM public.purchase_request pr
        JOIN public.buyer_organization o ON o.id = pr.organization_id CROSS JOIN w
       WHERE pr.deleted_at IS NULL AND pr.submitted_at IS NOT NULL
         AND ${inWindow('pr.submitted_at')} AND ${inStates('o.state_id')}`,
  },
  'buying_requests.created': {
    needs: ['buying_request'],
    located: true,
    breakdown: `${W}
      SELECT r.poster_type AS key, count(*)::int AS value FROM public.buying_request r CROSS JOIN w
       WHERE r.deleted_at IS NULL AND ${inWindow('r.created_at')} AND ${inStates('r.state_id')}
       GROUP BY 1 ORDER BY 1`,
  },
  'buying_requests.active_now': {
    needs: ['buying_request'],
    located: true,
    total: `${W}
      SELECT count(*)::int AS value FROM public.buying_request r CROSS JOIN w
       WHERE r.deleted_at IS NULL AND r.status = 'active' AND ${inStates('r.state_id')}`,
  },
  'services.created': {
    needs: ['service_listing'],
    located: true,
    breakdown: `${W}
      SELECT sv.service_type AS key, count(*)::int AS value FROM public.service_listing sv CROSS JOIN w
       WHERE sv.deleted_at IS NULL AND ${inWindow('sv.created_at')} AND ${inStates('sv.state_id')}
       GROUP BY 1 ORDER BY 1`,
  },
  'services.active_now': {
    needs: ['service_listing'],
    located: true,
    total: `${W}
      SELECT count(*)::int AS value FROM public.service_listing sv CROSS JOIN w
       WHERE sv.deleted_at IS NULL AND sv.status = 'active' AND ${inStates('sv.state_id')}`,
  },
  'messages.conversations': {
    needs: ['conversation', 'buying_request', 'service_listing'],
    located: true,
    breakdown: `${W}
      SELECT c.post_kind AS key, count(*)::int AS value FROM public.conversation c CROSS JOIN w
       WHERE ${inWindow('c.created_at')} AND ${inStates(`(${POST_STATE})`)}
       GROUP BY 1 ORDER BY 1`,
  },
  'messages.sent': {
    needs: ['conversation', 'message', 'buying_request', 'service_listing'],
    located: true,
    total: `${W}
      SELECT count(*)::int AS value
        FROM public.message m JOIN public.conversation c ON c.id = m.conversation_id CROSS JOIN w
       WHERE m.deleted_at IS NULL AND ${inWindow('m.created_at')} AND ${inStates(`(${POST_STATE})`)}`,
  },
  'inquiries.contact_requests': {
    needs: ['contact_request'],
    located: true,
    total: `${W}
      SELECT count(*)::int AS value
        FROM public.contact_request cr
        JOIN public.produce_listing l ON l.id = cr.listing_id CROSS JOIN w
       WHERE ${inWindow('cr.created_at')} AND ${inStates('l.state_id')}`,
  },
  'moderation.reports': {
    needs: ['market_report'],
    located: true,
    breakdown: `${W}, r AS (
        SELECT 'listing'::text AS key, l.state_id, pr.created_at
          FROM public.product_report pr JOIN public.produce_listing l ON l.id = pr.listing_id
         WHERE pr.deleted_at IS NULL
        UNION ALL
        SELECT 'buying_request', b.state_id, mr.created_at
          FROM public.market_report mr JOIN public.buying_request b ON b.id = mr.buying_request_id
         WHERE mr.deleted_at IS NULL
        UNION ALL
        SELECT 'service_listing', sv.state_id, mr.created_at
          FROM public.market_report mr JOIN public.service_listing sv ON sv.id = mr.service_listing_id
         WHERE mr.deleted_at IS NULL
      )
      SELECT r.key, count(*)::int AS value FROM r CROSS JOIN w
       WHERE ${inWindow('r.created_at')} AND ${inStates('r.state_id')}
       GROUP BY 1 ORDER BY 1`,
  },
  'support.received': {
    needs: ['support_message'],
    located: false,
    breakdown: `${W}
      SELECT sm.topic AS key, count(*)::int AS value FROM public.support_message sm CROSS JOIN w
       WHERE sm.deleted_at IS NULL AND ${inWindow('sm.created_at')} AND w.st IS NULL
       GROUP BY 1 ORDER BY 1`,
  },
  'accounts.suspended_now': {
    needs: ['farmer.suspended_at', 'buyer.suspended_at'],
    located: true,
    breakdown: `${W}, sus AS (
        SELECT 'farmer'::text AS key, f.state_id
          FROM public.farmer f WHERE f.deleted_at IS NULL AND f.suspended_at IS NOT NULL
        UNION ALL
        SELECT 'buyer', o.state_id
          FROM public.buyer b JOIN public.buyer_organization o ON o.id = b.organization_id
         WHERE b.deleted_at IS NULL AND o.deleted_at IS NULL AND b.suspended_at IS NOT NULL
      )
      SELECT sus.key, count(*)::int AS value FROM sus CROSS JOIN w
       WHERE ${inStates('sus.state_id')}
       GROUP BY 1 ORDER BY 1`,
  },
  // ---- Advice (2026-10-25). National only: a case carries no state. Never a
  // question, a message, a comment or a storage path: counts and averages.
  'advice.providers_published': {
    needs: ['advice_provider', 'farmer.suspended_at', 'buyer.suspended_at'],
    located: false,
    total: `${W}
      SELECT count(*)::int AS value FROM public.advice_provider ap CROSS JOIN w
       WHERE ap.deleted_at IS NULL AND ap.status = 'published' AND w.st IS NULL
         AND (EXISTS (SELECT 1 FROM public.farmer f
                       WHERE f.auth_user_id = ap.auth_user_id AND f.deleted_at IS NULL
                         AND f.suspended_at IS NULL)
              OR EXISTS (SELECT 1 FROM public.buyer b
                          WHERE b.auth_user_id = ap.auth_user_id AND b.deleted_at IS NULL
                            AND b.suspended_at IS NULL))`,
  },
  'advice.approved_advisers': {
    needs: ['advice_provider', 'adviser_application'],
    located: false,
    total: `${W}
      SELECT count(*)::int AS value FROM public.advice_provider ap CROSS JOIN w
       WHERE ap.deleted_at IS NULL AND ap.approved_at IS NOT NULL AND w.st IS NULL`,
  },
  'advice.requests': {
    needs: ['advice_case'],
    located: false,
    breakdown: `${W}
      SELECT ac.topic AS key, count(*)::int AS value FROM public.advice_case ac CROSS JOIN w
       WHERE ac.deleted_at IS NULL AND ${inWindow('ac.created_at')} AND w.st IS NULL
       GROUP BY 1 ORDER BY 1`,
  },
  'advice.cases_closed': {
    needs: ['advice_case'],
    located: false,
    breakdown: `${W}
      SELECT ac.outcome AS key, count(*)::int AS value FROM public.advice_case ac CROSS JOIN w
       WHERE ac.deleted_at IS NULL AND ac.status = 'closed' AND ${inWindow('ac.closed_at')}
         AND w.st IS NULL
       GROUP BY 1 ORDER BY 1`,
  },
  'advice.median_days_to_close': {
    needs: ['advice_case'],
    located: false,
    total: `${W}
      SELECT round((percentile_cont(0.5) WITHIN GROUP (
               ORDER BY extract(epoch FROM ac.closed_at - ac.created_at) / 86400))::numeric, 1
             )::float8 AS value
        FROM public.advice_case ac CROSS JOIN w
       WHERE ac.deleted_at IS NULL AND ac.status = 'closed' AND ${inWindow('ac.closed_at')}
         AND w.st IS NULL`,
  },
  'advice.feedback_given': {
    needs: ['advice_case'],
    located: false,
    breakdown: `${W}, ${ADVICE_RATED}
      SELECT rated.feedback_rating::text AS key, count(*)::int AS value FROM rated
       GROUP BY 1 ORDER BY 1`,
  },
  'advice.average_rating': {
    needs: ['advice_case'],
    located: false,
    total: `${W}, ${ADVICE_RATED}
      SELECT round(avg(rated.feedback_rating)::numeric, 1)::float8 AS value FROM rated`,
  },
  'advice.applications_submitted': {
    needs: ['adviser_application'],
    located: false,
    total: `${W}
      SELECT count(*)::int AS value FROM public.adviser_application aa CROSS JOIN w
       WHERE aa.deleted_at IS NULL AND ${inWindow('aa.created_at')} AND w.st IS NULL`,
  },
  'advice.applications_decided': {
    needs: ['adviser_application'],
    located: false,
    breakdown: `${W}
      SELECT replace(ae.action, 'adviser_application.', '') AS key,
             count(DISTINCT ae.entity_id)::int AS value
        FROM public.audit_event ae CROSS JOIN w
       WHERE ae.action IN ('adviser_application.approved', 'adviser_application.declined')
         AND ${inWindow('ae.occurred_at')} AND w.st IS NULL
       GROUP BY 1 ORDER BY 1`,
  },
  'advice.referrals': {
    needs: ['advice_referral'],
    located: false,
    breakdown: `${W}
      SELECT rf.status AS key, count(*)::int AS value FROM public.advice_referral rf CROSS JOIN w
       WHERE rf.deleted_at IS NULL AND ${inWindow('rf.created_at')} AND w.st IS NULL
       GROUP BY 1 ORDER BY 1`,
  },
  'system.failures': {
    needs: [],
    located: false,
    breakdown: `${W}
      SELECT ae.action AS key, count(*)::int AS value FROM public.audit_event ae CROSS JOIN w
       WHERE ae.action IN ('visit.attachment_failed', 'communication.send_failed',
                           'auth.disable_failed', 'staff.sessions_revoke_failed')
         AND ${inWindow('ae.occurred_at')} AND w.st IS NULL
       GROUP BY 1 ORDER BY 1`,
  },
};

/** Everything a pending migration may not have created yet, asked in one query. */
const PROBED = [
  'access_log',
  'account_profile',
  'buyer_organization',
  'purchase_order',
  'purchase_request',
  'buying_request',
  'service_listing',
  'market_report',
  'conversation',
  'message',
  'contact_request',
  'phone_verification',
  'support_message',
  // 2026-10-25: advice.
  'advice_provider',
  'advice_case',
  'adviser_application',
  'advice_referral',
] as const;

async function presentRelations(db: Db): Promise<Set<string>> {
  const rows = await db.$queryRawUnsafe<{ name: string }[]>(
    `SELECT t AS name FROM unnest($1::text[]) AS t WHERE to_regclass('public.' || t) IS NOT NULL
     UNION ALL
     SELECT (c.table_name || '.' || c.column_name)::text FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND ((c.table_name IN ('farmer', 'buyer') AND c.column_name = 'suspended_at')
          OR (c.table_name = 'account_profile' AND c.column_name = 'enterprise_size'))`,
    [...PROBED],
  );
  return new Set(rows.map((r) => r.name));
}

/** The query as it ran, parameters inlined, for the export record (CLAUDE.md, Reporting). */
export function inlineAnalyticsQuery(sql: string, params: readonly unknown[]): string {
  return sql.replace(/\$(\d+)/g, (match, n: string) => {
    const v = params[Number(n) - 1];
    if (v === undefined) return match;
    if (v === null) return 'NULL';
    if (v instanceof Date) return `'${v.toISOString()}'`;
    if (Array.isArray(v))
      return `ARRAY[${v.map((s) => `'${String(s).replace(/'/g, "''")}'`).join(', ')}]`;
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

export interface AnalyticsRun {
  readonly summary: AnalyticsSummary;
  /** Each query as it ran, with its parameters inlined, keyed by metric id. */
  readonly queries: readonly { id: string; sql: string }[];
}

/**
 * Every figure for one window, limited to `states` (null: national). The
 * caller has already decided `states` from the role and the permission.
 */
export async function analyticsSummary(
  db: Db,
  window: AnalyticsWindow,
  states: readonly string[] | null,
  requestedState: string | null,
  now: Date = new Date(),
): Promise<AnalyticsRun> {
  const present = await presentRelations(db);
  const params = [window.startsAt, window.endsAt, states ? [...states] : null];
  const queries: { id: string; sql: string }[] = [];
  const metrics: AnalyticsMetricValue[] = [];

  for (const def of ANALYTICS_METRICS) {
    const spec = METRIC_SQL[def.id];
    if (!spec) throw new Error(`analytics: no SQL for ${def.id}`);
    if (!spec.located && states !== null) {
      metrics.push({ id: def.id, value: null, unavailable: 'not_located' });
      continue;
    }
    if (spec.needs.some((n) => !present.has(n))) {
      metrics.push({ id: def.id, value: null, unavailable: 'not_in_database' });
      continue;
    }
    let breakdown: { key: string; label?: string; value: number }[] | undefined;
    if (spec.breakdown) {
      queries.push({ id: def.id, sql: inlineAnalyticsQuery(spec.breakdown, params) });
      const rows = await db.$queryRawUnsafe<
        { key: string | null; label?: string | null; value: number }[]
      >(spec.breakdown, ...params);
      breakdown = rows.map((r) => ({
        key: r.key ?? 'none',
        ...(r.label ? { label: r.label } : {}),
        value: Number(r.value),
      }));
    }
    let value: number;
    if (spec.total) {
      queries.push({ id: def.id, sql: inlineAnalyticsQuery(spec.total, params) });
      const [row] = await db.$queryRawUnsafe<{ value: number | null }[]>(spec.total, ...params);
      // A count is never null; a median or an average of nothing is, and is
      // served as not measured rather than as a silent 0 (2026-10-25).
      if (row && row.value === null) {
        metrics.push({ id: def.id, value: null, unavailable: 'none_in_window' });
        continue;
      }
      value = Number(row?.value ?? 0);
    } else {
      value = (breakdown ?? []).reduce((n, b) => n + b.value, 0);
    }
    metrics.push({ id: def.id, value, ...(breakdown ? { breakdown } : {}) });
  }

  return {
    summary: {
      window: {
        from: window.from,
        to: window.to,
        days: window.days,
        time_zone: DISPLAY_TIME_ZONE,
      },
      state_id: requestedState,
      scope_states: states ? [...states] : null,
      generated_at: toIso(now),
      metrics,
      limitations: ANALYTICS_LIMITATIONS,
    },
    queries,
  };
}
