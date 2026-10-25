import {
  type AdminOverview,
  type AdminOverviewFilter,
  type AnalyticsWindow,
  DISPLAY_TIME_ZONE,
  type OverviewCaseId,
  type OverviewFigure,
  type OverviewTileId,
  SETTING_DEFAULTS,
  fillDays,
  fillMarketDays,
  overviewAlerts,
  toIso,
} from '@agri-erp/shared';
import { type Prisma } from '@prisma/client';

import {
  BUYING_REQUEST_FROM,
  BUYING_REQUEST_MARKET_WHERE,
  SERVICE_FROM,
  SERVICE_MARKET_WHERE,
} from './market-posts';
import { currentSetting, integrationStatus, settingsTablesPresent } from './settings';

/**
 * THE ADMINISTRATION OVERVIEW, THE QUERIES (2026-10-28). Served by
 * GET /api/admin/overview; the shapes, links and alerts are pure and live in
 * packages/shared/src/admin-overview.ts.
 *
 * EVERY QUERY TAKES THE SAME FOUR PARAMETERS through one CTE `w`, as the
 * analytics queries do (lib/api/analytics.ts): the window's first instant
 * (s), the instant after its last day (e), both at Juba midnight, the states
 * to limit to (st, NULL for national) and the actor type (act, NULL for all).
 *
 * Counts only: no name, phone, email or message text is selected. Soft-deleted
 * rows are out of every count. A "live" post is counted exactly as the market
 * shows it: the same joins and conditions (lib/api/market-posts.ts, the
 * listings route), so a suspended account's posts are not counted as active.
 *
 * THE ACTOR FILTER reads the activities an account declares on its profile
 * (account_profile.activities), or an organisation on its own. A farmer an
 * officer registered has no sign-in and no profile; they count as a farmer.
 * Cases are not narrowed by actor: a report or a message names no activity.
 */

type Db = { $queryRawUnsafe: Prisma.TransactionClient['$queryRawUnsafe'] };

const W = `w AS (SELECT $1::timestamptz AS s, $2::timestamptz AS e, $3::text[] AS st,
                        $4::text AS act)`;

const inWindow = (column: string) => `${column} >= w.s AND ${column} < w.e`;
const inStates = (column: string) => `(w.st IS NULL OR ${column} = ANY(w.st))`;
const jubaDay = (column: string) =>
  `to_char((${column} AT TIME ZONE '${DISPLAY_TIME_ZONE}')::date, 'YYYY-MM-DD')`;

/** The account (sign-in) declares the actor type; or, for a post, its organisation does. */
const actorOf = (authUser: string, organization?: string) => `(w.act IS NULL
  OR EXISTS (SELECT 1 FROM public.account_profile apx
              WHERE apx.auth_user_id = ${authUser} AND w.act = ANY(apx.activities))
  ${
    organization
      ? `OR EXISTS (SELECT 1 FROM public.organization ogx
                     WHERE ogx.id = ${organization} AND w.act = ANY(ogx.activities))`
      : ''
  })`;

/**
 * Every person on the register: live farmer records (not merged away) and
 * live buyers, each with a state and its sign-in if any, narrowed to the
 * states and the actor type. A farmer without a sign-in counts as a farmer.
 */
const Q = `p AS (
    SELECT 'farmer'::text AS kind, f.id, f.state_id, f.auth_user_id,
           (f.suspended_at IS NOT NULL) AS suspended
      FROM public.farmer f WHERE f.deleted_at IS NULL AND f.merged_into IS NULL
    UNION ALL
    SELECT 'buyer', b.id, o.state_id, b.auth_user_id, (b.suspended_at IS NOT NULL)
      FROM public.buyer b JOIN public.buyer_organization o ON o.id = b.organization_id
     WHERE b.deleted_at IS NULL AND o.deleted_at IS NULL
  ),
  q AS (
    SELECT p.* FROM p CROSS JOIN w
     WHERE ${inStates('p.state_id')}
       AND (${actorOf('p.auth_user_id')}
            OR (w.act = 'farmer' AND p.kind = 'farmer' AND p.auth_user_id IS NULL))
  )`;

const SIGNED_IN = `('first_sign_in', 'sign_in', 'return_session')`;

const SQL = {
  register: `WITH ${W}, ${Q}
    SELECT count(DISTINCT COALESCE(q.auth_user_id::text, q.kind || ':' || q.id::text))::int
             AS people,
           count(DISTINCT q.auth_user_id)::int AS accounts,
           count(DISTINCT q.auth_user_id) FILTER (WHERE q.suspended)::int AS suspended
      FROM q`,

  organisations: `WITH ${W}
    SELECT count(*)::int AS value,
           count(*) FILTER (WHERE og.status = 'published')::int AS published
      FROM public.organization og CROSS JOIN w
     WHERE og.deleted_at IS NULL AND og.closed_at IS NULL
       AND ${inStates('og.state_id')}
       AND (w.act IS NULL OR w.act = ANY(og.activities))`,

  newAccounts: `WITH ${W}, ${Q}
    SELECT count(DISTINCT q.auth_user_id)::int AS value
      FROM public.access_log a JOIN q ON q.kind = a.principal_kind AND q.id = a.principal_id
      CROSS JOIN w
     WHERE a.event = 'account_created' AND ${inWindow('a.occurred_at')}`,

  registrationsByDay: `WITH ${W}, ${Q}
    SELECT ${jubaDay('a.occurred_at')} AS day, count(DISTINCT q.auth_user_id)::int AS value
      FROM public.access_log a JOIN q ON q.kind = a.principal_kind AND q.id = a.principal_id
      CROSS JOIN w
     WHERE a.event = 'account_created' AND ${inWindow('a.occurred_at')}
     GROUP BY 1`,

  activeUsers: `WITH ${W}, ${Q}
    SELECT count(DISTINCT q.auth_user_id)::int AS value
      FROM public.access_log a JOIN q ON q.kind = a.principal_kind AND q.id = a.principal_id
      CROSS JOIN w
     WHERE a.event IN ${SIGNED_IN} AND ${inWindow('a.occurred_at')}`,

  // As /api/listings shows them: listed, not expired, its farmer neither removed nor suspended.
  activeListings: `WITH ${W}
    SELECT count(*)::int AS value,
           count(*) FILTER (WHERE pl.category::text = 'seeds_inputs')::int AS inputs
      FROM public.produce_listing pl
      JOIN public.farmer f ON f.id = pl.farmer_id AND f.deleted_at IS NULL
        AND f.suspended_at IS NULL
      CROSS JOIN w
     WHERE pl.deleted_at IS NULL AND pl.status = 'listed'
       AND (pl.available_until IS NULL OR pl.available_until >= current_date)
       AND ${inStates('pl.state_id')} AND ${actorOf('f.auth_user_id')}`,

  activeServices: `WITH ${W}
    SELECT count(*)::int AS value ${SERVICE_FROM} CROSS JOIN w
     WHERE ${SERVICE_MARKET_WHERE}
       AND ${inStates('sl.state_id')}
       AND ${actorOf('COALESCE(f.auth_user_id, b.auth_user_id)', 'sl.organization_id')}`,

  activeBuyingRequests: `WITH ${W}
    SELECT count(*)::int AS value ${BUYING_REQUEST_FROM} CROSS JOIN w
     WHERE ${BUYING_REQUEST_MARKET_WHERE}
       AND ${inStates('br.state_id')}
       AND ${actorOf('COALESCE(f.auth_user_id, b.auth_user_id)', 'br.organization_id')}`,

  // Offers (produce, inputs and services) and buying requests created per Juba day.
  marketByDay: `WITH ${W}, x AS (
      SELECT ${jubaDay('pl.created_at')} AS day, 1 AS listings, 0 AS buying_requests
        FROM public.produce_listing pl
        LEFT JOIN public.farmer f ON f.id = pl.farmer_id CROSS JOIN w
       WHERE pl.deleted_at IS NULL AND ${inWindow('pl.created_at')}
         AND ${inStates('pl.state_id')} AND ${actorOf('f.auth_user_id')}
      UNION ALL
      SELECT ${jubaDay('sv.created_at')}, 1, 0
        FROM public.service_listing sv
        LEFT JOIN public.farmer f ON f.id = sv.farmer_id
        LEFT JOIN public.buyer b ON b.id = sv.buyer_id CROSS JOIN w
       WHERE sv.deleted_at IS NULL AND ${inWindow('sv.created_at')}
         AND ${inStates('sv.state_id')}
         AND ${actorOf('COALESCE(f.auth_user_id, b.auth_user_id)', 'sv.organization_id')}
      UNION ALL
      SELECT ${jubaDay('r.created_at')}, 0, 1
        FROM public.buying_request r
        LEFT JOIN public.farmer f ON f.id = r.farmer_id
        LEFT JOIN public.buyer b ON b.id = r.buyer_id CROSS JOIN w
       WHERE r.deleted_at IS NULL AND ${inWindow('r.created_at')}
         AND ${inStates('r.state_id')}
         AND ${actorOf('COALESCE(f.auth_user_id, b.auth_user_id)', 'r.organization_id')}
    )
    SELECT day, sum(listings)::int AS listings, sum(buying_requests)::int AS buying_requests
      FROM x GROUP BY day`,

  // Open = not yet resolved or closed. 'done' (the first inbox's only end) is closed.
  supportCases: `WITH ${W}
    SELECT count(*) FILTER (WHERE sm.topic <> 'appeal')::int AS support,
           count(*) FILTER (WHERE sm.topic = 'appeal')::int AS appeals
      FROM public.support_message sm CROSS JOIN w
     WHERE sm.deleted_at IS NULL AND sm.status IN ('new', 'in_progress', 'waiting')
       AND w.st IS NULL`,

  productReports: `WITH ${W}, r AS (
      SELECT l.state_id FROM public.product_report pr
        JOIN public.produce_listing l ON l.id = pr.listing_id
       WHERE pr.deleted_at IS NULL AND pr.status::text IN ('new', 'reviewing')
      UNION ALL
      SELECT COALESCE(b.state_id, sv.state_id) FROM public.market_report mr
        LEFT JOIN public.buying_request b ON b.id = mr.buying_request_id
        LEFT JOIN public.service_listing sv ON sv.id = mr.service_listing_id
       WHERE mr.deleted_at IS NULL AND mr.status::text IN ('new', 'reviewing')
    )
    SELECT count(*)::int AS value FROM r CROSS JOIN w WHERE ${inStates('r.state_id')}`,

  corrections: `WITH ${W}
    SELECT count(*)::int AS value
      FROM public.listing_correction c
      LEFT JOIN public.produce_listing pl ON pl.id = c.produce_listing_id
      LEFT JOIN public.service_listing sv ON sv.id = c.service_listing_id
      LEFT JOIN public.buying_request br ON br.id = c.buying_request_id
      CROSS JOIN w
     WHERE c.deleted_at IS NULL AND c.status = 'open'
       AND ${inStates('COALESCE(pl.state_id, sv.state_id, br.state_id)')}`,

  adviserApplications: `WITH ${W}
    SELECT count(*)::int AS value FROM public.adviser_application aa CROSS JOIN w
     WHERE aa.deleted_at IS NULL AND aa.status IN ('submitted', 'clarification_requested')
       AND w.st IS NULL`,

  // National: the same actions as the analytics 'system.failures' figure, plus
  // a suspension whose text message could not be sent (its audit row says so).
  failures: `WITH ${W}
    SELECT CASE WHEN ae.action = 'account.suspended' THEN 'suspension_sms_failed'
                ELSE ae.action END AS key,
           count(*)::int AS value
      FROM public.audit_event ae CROSS JOIN w
     WHERE (ae.action IN ('visit.attachment_failed', 'communication.send_failed',
                          'auth.disable_failed', 'staff.sessions_revoke_failed')
            OR (ae.action = 'account.suspended' AND ae.after ->> 'notice_sms' = 'failed'))
       AND ${inWindow('ae.occurred_at')} AND w.st IS NULL
     GROUP BY 1`,
} as const;

/** Tables a pending migration may not have created yet, asked in one query. */
const PROBED = [
  'access_log',
  'account_profile',
  'organization',
  'buying_request',
  'service_listing',
  'market_report',
  'listing_correction',
  'support_message',
  'adviser_application',
] as const;
type Probed = (typeof PROBED)[number];

async function presentTables(db: Db): Promise<Set<string>> {
  const rows = await db.$queryRawUnsafe<{ name: string }[]>(
    `SELECT t AS name FROM unnest($1::text[]) AS t WHERE to_regclass('public.' || t) IS NOT NULL`,
    [...PROBED],
  );
  return new Set(rows.map((r) => r.name));
}

export interface OverviewOptions {
  readonly window: AnalyticsWindow;
  readonly filter: AdminOverviewFilter;
  /** The states the caller may see (null: national), from analyticsStates. */
  readonly states: readonly string[] | null;
  /** Whether the caller holds settings.manage: only then are integrations named. */
  readonly seesSettings: boolean;
  readonly now?: Date;
}

export async function adminOverview(db: Db, options: OverviewOptions): Promise<AdminOverview> {
  const { window, filter, states, seesSettings } = options;
  const present = await presentTables(db);
  const missing = PROBED.filter((t) => !present.has(t));
  const has = (...tables: Probed[]) => tables.every((t) => present.has(t));
  const params = [
    window.startsAt,
    window.endsAt,
    states ? [...states] : null,
    filter.actor ?? null,
  ];
  const run = <T>(sql: string) => db.$queryRawUnsafe<T[]>(sql, ...params);
  const one = async (sql: string) => Number((await run<{ value: number }>(sql))[0]?.value ?? 0);

  const tile = (
    id: OverviewTileId,
    value: number | null,
    extra: Pick<OverviewFigure, 'part'> = {},
  ): OverviewFigure<OverviewTileId> =>
    value === null ? { id, value: null, unavailable: 'not_in_database' } : { id, value, ...extra };
  const caseOf = (
    id: OverviewCaseId,
    value: number | null,
    located: boolean,
  ): OverviewFigure<OverviewCaseId> => {
    if (!located && states !== null) return { id, value: null, unavailable: 'not_located' };
    if (value === null) return { id, value: null, unavailable: 'not_in_database' };
    return { id, value };
  };

  // Account figures need account_profile for the actor filter.
  const accountsReady = has('account_profile');
  const register = accountsReady
    ? (await run<{ people: number; accounts: number; suspended: number }>(SQL.register))[0]
    : undefined;
  const orgs = has('organization')
    ? (await run<{ value: number; published: number }>(SQL.organisations))[0]
    : undefined;
  const accessReady = accountsReady && has('access_log');
  const marketReady = accountsReady && has('organization', 'buying_request', 'service_listing');
  const listings = accountsReady
    ? (await run<{ value: number; inputs: number }>(SQL.activeListings))[0]
    : undefined;

  const tiles: OverviewFigure<OverviewTileId>[] = [
    tile('people', register ? Number(register.people) : null),
    tile(
      'accounts',
      register ? Number(register.accounts) : null,
      register ? { part: { label: 'suspended', value: Number(register.suspended) } } : {},
    ),
    tile(
      'organisations',
      orgs ? Number(orgs.value) : null,
      orgs ? { part: { label: 'published', value: Number(orgs.published) } } : {},
    ),
    tile('new_accounts', accessReady ? await one(SQL.newAccounts) : null),
    tile('active_users', accessReady ? await one(SQL.activeUsers) : null),
    tile(
      'active_listings',
      listings ? Number(listings.value) : null,
      listings ? { part: { label: 'inputs', value: Number(listings.inputs) } } : {},
    ),
    tile('active_services', marketReady ? await one(SQL.activeServices) : null),
    tile('active_buying_requests', marketReady ? await one(SQL.activeBuyingRequests) : null),
  ];

  const support = has('support_message')
    ? (await run<{ support: number; appeals: number }>(SQL.supportCases))[0]
    : undefined;
  const cases: OverviewFigure<OverviewCaseId>[] = [
    caseOf('support', support ? Number(support.support) : null, false),
    caseOf('appeals', support ? Number(support.appeals) : null, false),
    caseOf(
      'product_reports',
      has('market_report', 'buying_request', 'service_listing')
        ? await one(SQL.productReports)
        : null,
      true,
    ),
    caseOf(
      'corrections',
      has('listing_correction', 'buying_request', 'service_listing')
        ? await one(SQL.corrections)
        : null,
      true,
    ),
    caseOf(
      'adviser_applications',
      has('adviser_application') ? await one(SQL.adviserApplications) : null,
      false,
    ),
  ];

  const registrations = accessReady
    ? fillDays(
        window.from,
        window.to,
        await run<{ day: string; value: number }>(SQL.registrationsByDay),
      )
    : null;
  const market = fillMarketDays(
    window.from,
    window.to,
    marketReady
      ? await run<{ day: string; listings: number; buying_requests: number }>(SQL.marketByDay)
      : [],
  );

  const failures =
    states === null
      ? Object.fromEntries(
          (await run<{ key: string; value: number }>(SQL.failures)).map((r) => [
            r.key,
            Number(r.value),
          ]),
        )
      : null;

  const maintenance: { enabled: boolean; message: string } = (await settingsTablesPresent(db))
    ? (await currentSetting('maintenance', db)).value
    : SETTING_DEFAULTS.maintenance;

  return {
    window: { from: window.from, to: window.to, days: window.days, time_zone: DISPLAY_TIME_ZONE },
    state_id: filter.state_id ?? null,
    actor: filter.actor ?? null,
    scope_states: states ? [...states] : null,
    generated_at: toIso(options.now ?? new Date()),
    tiles,
    cases,
    trends: { registrations, market },
    alerts: overviewAlerts({
      integrations: seesSettings ? integrationStatus() : null,
      failures,
      maintenance,
      missingTables: missing,
    }),
  };
}
