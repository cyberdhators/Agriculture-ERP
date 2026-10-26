import {
  DISPLAY_TIME_ZONE,
  accountSearch,
  accountStatusOf,
  advisoryStatusOf,
  toIso,
  type AccountStatus,
  type AdminAccountFilter,
  type AdminAccountRow,
  type AccountDetailKind,
  type SignInMethod,
} from '@agri-erp/shared';

/**
 * THE ACCOUNTS LIST, AS SQL (2026-10-28). No database import: the builders
 * return text and parameters, so their shape is tested without one
 * (admin-accounts.test.ts) and the routes run them.
 *
 * A PERSON row is a sign-in account with its farmer and buyer records joined
 * (one account, many activities), or a farmer an officer registered with no
 * sign-in. Merged-away farmer records and anything soft-deleted are never
 * read (the deletion law). An ORGANISATION row is an organisational profile
 * that is not deleted; a closed one is listed as closed.
 *
 * The phone is selected only to be MASKED by the route, and to be searched
 * when the caller may search by contact. It never leaves the server in clear.
 */

/**
 * AN ACCOUNT'S ACTOR TYPES -- ONE RULE, TWO SCREENS (2026-10-29).
 * docs/DECISIONS.md, "An account's actor types are its declared activities
 * plus the records it holds".
 *
 * The activities the account declares on its profile (account_profile.
 * activities), PLUS 'farmer' when it holds a live farmer record and 'buyer'
 * when it holds a live buyer record. So a new account that has not filled in
 * its profile is still a farmer or a buyer, and a farmer an officer
 * registered (no sign-in, no profile) is a farmer. The accounts list shows
 * these and filters by them; the overview's actor filter counts by the same
 * expression (lib/api/admin-overview.ts), so the two cannot disagree.
 *
 * Each argument is a SQL expression: the profile's activities (text[], may be
 * NULL), and the farmer and buyer record ids (NULL when the account has none).
 */
export function actorTypesSql(refs: { activities: string; farmer: string; buyer: string }): string {
  return `ARRAY(SELECT DISTINCT a FROM unnest(
              COALESCE(${refs.activities}, '{}'::text[])
              || CASE WHEN ${refs.farmer} IS NOT NULL THEN ARRAY['farmer'] ELSE '{}'::text[] END
              || CASE WHEN ${refs.buyer} IS NOT NULL THEN ARRAY['buyer'] ELSE '{}'::text[] END) a
            ORDER BY a)`;
}

/** The same rule in code, for the tests and any screen that has the parts in hand. */
export function actorTypesOf(parts: {
  activities: readonly string[] | null;
  hasFarmer: boolean;
  hasBuyer: boolean;
}): string[] {
  const all = new Set(parts.activities ?? []);
  if (parts.hasFarmer) all.add('farmer');
  if (parts.hasBuyer) all.add('buyer');
  return [...all].sort();
}

const ACCOUNTS_CTE = `
  ids AS (
    SELECT auth_user_id FROM public.farmer
     WHERE deleted_at IS NULL AND merged_into IS NULL AND auth_user_id IS NOT NULL
    UNION
    SELECT auth_user_id FROM public.buyer_active
  ),
  persons AS (
    SELECT i.auth_user_id, f.id AS farmer_id, b.id AS buyer_id
      FROM ids i
      LEFT JOIN public.farmer f
        ON f.auth_user_id = i.auth_user_id AND f.deleted_at IS NULL AND f.merged_into IS NULL
      LEFT JOIN public.buyer_active b ON b.auth_user_id = i.auth_user_id
    UNION ALL
    SELECT NULL::uuid, f.id, NULL::uuid
      FROM public.farmer f
     WHERE f.deleted_at IS NULL AND f.merged_into IS NULL AND f.auth_user_id IS NULL
  ),
  rows AS (
    SELECT
      CASE WHEN p.farmer_id IS NOT NULL THEN 'farmer' ELSE 'buyer' END AS kind,
      COALESCE(p.farmer_id, p.buyer_id) AS id,
      p.auth_user_id,
      p.farmer_id,
      p.buyer_id,
      COALESCE(NULLIF(btrim(ap.display_name), ''),
               f.given_name || ' ' || f.family_name,
               b.given_name || ' ' || b.family_name) AS name,
      CASE WHEN p.auth_user_id IS NULL THEN 'none'
           WHEN f.id IS NOT NULL THEN 'phone' ELSE 'email' END AS sign_in,
      f.farmer_number,
      COALESCE(f.phone, b.phone) AS phone,
      ${actorTypesSql({ activities: 'ap.activities', farmer: 'f.id', buyer: 'b.id' })} AS actor_types,
      (CASE WHEN bo.id IS NOT NULL THEN ARRAY[bo.name] ELSE '{}'::text[] END)
        || COALESCE((SELECT array_agg(o.name ORDER BY o.name)
                       FROM public.organization_member m
                       JOIN public.organization o
                         ON o.id = m.organization_id AND o.deleted_at IS NULL
                      WHERE p.auth_user_id IS NOT NULL AND m.auth_user_id = p.auth_user_id
                        AND m.status = 'active'), '{}'::text[]) AS organisations,
      COALESCE(f.state_id, ap.state_id, bo.state_id) AS state_id,
      LEAST(f.created_at, b.created_at) AS joined_at,
      act.first_sign_in_at,
      act.last_seen_at,
      COALESCE(f.suspended_at, b.suspended_at) AS suspended_at,
      COALESCE(f.disabled_at, b.disabled_at) AS disabled_at,
      FALSE AS closed,
      -- 2026-10-31 (the owner): only organisations are verified. A person's
      -- row shows its buyer organisation's verification when that is a
      -- business, and nothing for an individual -- not the extension
      -- programme's field record of a farmer, which stays with the officers.
      CASE WHEN bo.account_type::text <> 'individual' THEN bo.verification_status::text END
        AS verification,
      (f.id IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.phone_verification pv
          WHERE pv.phone = f.phone AND pv.verified_at IS NOT NULL)) AS phone_verified,
      COALESCE(ap.status, 'none') AS publication,
      adv.status AS provider_status,
      (adv.approved_at IS NOT NULL) AS adviser_approved,
      app.status AS application_status
    FROM persons p
    LEFT JOIN public.farmer f ON f.id = p.farmer_id
    LEFT JOIN public.buyer b ON b.id = p.buyer_id
    LEFT JOIN public.buyer_organization bo ON bo.id = b.organization_id AND bo.deleted_at IS NULL
    LEFT JOIN public.account_profile ap ON ap.auth_user_id = p.auth_user_id
    LEFT JOIN LATERAL (
      SELECT min(a.first_sign_in_at) AS first_sign_in_at, max(a.last_seen_at) AS last_seen_at
        FROM public.account_activity a
       WHERE (a.principal_kind = 'farmer' AND a.principal_id = p.farmer_id)
          OR (a.principal_kind = 'buyer' AND a.principal_id = p.buyer_id)
    ) act ON TRUE
    LEFT JOIN public.advice_provider adv
      ON adv.auth_user_id = p.auth_user_id AND adv.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT x.status FROM public.adviser_application x
       WHERE x.auth_user_id = p.auth_user_id AND x.deleted_at IS NULL
       ORDER BY x.created_at DESC LIMIT 1
    ) app ON TRUE
    UNION ALL
    SELECT 'organisation', o.id, NULL::uuid, NULL::uuid, NULL::uuid, o.name, 'none',
           NULL::text, NULL::text, COALESCE(o.activities, '{}'::text[]), '{}'::text[],
           o.state_id, o.created_at, NULL::timestamptz, NULL::timestamptz,
           NULL::timestamptz, NULL::timestamptz, (o.closed_at IS NOT NULL), o.verification_status, FALSE,
           o.status, NULL::text, FALSE, NULL::text
      FROM public.organization o
     WHERE o.deleted_at IS NULL
  )`;

export interface AccountSqlRow {
  kind: AccountDetailKind;
  id: string;
  auth_user_id: string | null;
  farmer_id: string | null;
  buyer_id: string | null;
  name: string;
  sign_in: SignInMethod;
  farmer_number: string | null;
  phone: string | null;
  actor_types: string[];
  organisations: string[];
  state_id: string | null;
  joined_at: Date;
  first_sign_in_at: Date | null;
  last_seen_at: Date | null;
  suspended_at: Date | null;
  disabled_at: Date | null;
  closed: boolean;
  verification: string | null;
  phone_verified: boolean;
  publication: string;
  provider_status: string | null;
  adviser_approved: boolean;
  application_status: string | null;
}

/** The SQL status expression a filter compares against (mirrors accountStatusOf). */
const STATUS_SQL = `CASE WHEN r.closed THEN 'closed'
  WHEN r.disabled_at IS NOT NULL THEN 'disabled'
  WHEN r.suspended_at IS NOT NULL THEN 'suspended' ELSE 'active' END`;

export interface AccountListQuery {
  sql: string;
  params: unknown[];
}

/**
 * The list query for a filter. `mayUseContact`: the caller holds
 * support.handle, so digits in the search box may match a phone ("search by
 * contact as permitted"). Keyset paging on (joined_at, id), newest first.
 */
export function accountListQuery(
  filter: AdminAccountFilter,
  options: {
    mayUseContact: boolean;
    limit: number;
    cursor: { createdAt: string; id: string } | null;
  },
): AccountListQuery {
  const params: unknown[] = [];
  const push = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where: string[] = [];
  if (filter.kind === 'organisation') where.push(`r.kind = 'organisation'`);
  if (filter.kind === 'person') where.push(`r.kind <> 'organisation'`);
  if (filter.sign_in === 'yes') where.push(`r.sign_in <> 'none'`);
  if (filter.sign_in === 'no') where.push(`r.sign_in = 'none' AND r.kind <> 'organisation'`);
  if (filter.state) where.push(`r.state_id = ${push(filter.state)}`);
  if (filter.actor) where.push(`${push(filter.actor)} = ANY (r.actor_types)`);
  if (filter.status) where.push(`${STATUS_SQL} = ${push(filter.status)}`);
  if (filter.from) {
    where.push(
      `r.joined_at >= (${push(filter.from)}::date::timestamp AT TIME ZONE '${DISPLAY_TIME_ZONE}')`,
    );
  }
  if (filter.to) {
    where.push(
      `r.joined_at < ((${push(filter.to)}::date + 1)::timestamp AT TIME ZONE '${DISPLAY_TIME_ZONE}')`,
    );
  }
  if (filter.q) {
    const s = accountSearch(filter.q, options.mayUseContact);
    const ors: string[] = [];
    const like = push(`%${s.text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    ors.push(`r.name ILIKE ${like}`, `r.farmer_number ILIKE ${like}`);
    ors.push(`EXISTS (SELECT 1 FROM unnest(r.organisations) n WHERE n ILIKE ${like})`);
    if (s.uuid) ors.push(`r.id = ${push(s.uuid)}::uuid`);
    if (s.digits) {
      ors.push(
        `regexp_replace(COALESCE(r.phone, ''), '\\D', '', 'g') LIKE ${push(`%${s.digits}%`)}`,
      );
    }
    where.push(`(${ors.join(' OR ')})`);
  }
  if (options.cursor) {
    const at = push(options.cursor.createdAt);
    const id = push(options.cursor.id);
    where.push(`(r.joined_at, r.id) < (${at}::timestamptz, ${id}::uuid)`);
  }
  const sql = `WITH ${ACCOUNTS_CTE}
SELECT r.* FROM rows r
${where.length ? `WHERE ${where.join('\n  AND ')}` : ''}
ORDER BY r.joined_at DESC, r.id DESC
LIMIT ${options.limit + 1}`;
  return { sql, params };
}

/** One row by its kind and id (a farmer or buyer record of the account, or an organisation). */
export function accountRowQuery(kind: AccountDetailKind, id: string): AccountListQuery {
  const match =
    kind === 'organisation'
      ? `r.kind = 'organisation' AND r.id = $1::uuid`
      : kind === 'farmer'
        ? `r.kind <> 'organisation' AND r.farmer_id = $1::uuid`
        : `r.kind <> 'organisation' AND r.buyer_id = $1::uuid`;
  return {
    sql: `WITH ${ACCOUNTS_CTE}\nSELECT r.* FROM rows r WHERE ${match} LIMIT 1`,
    params: [id],
  };
}

/** One SQL row as the list shows it. The phone is never in it. */
export function presentAccountRow(r: AccountSqlRow): AdminAccountRow {
  const status: AccountStatus = accountStatusOf(r);
  return {
    kind: r.kind,
    id: r.id,
    name: r.name,
    sign_in: r.sign_in,
    farmer_number: r.farmer_number,
    actor_types: r.actor_types ?? [],
    organisations: r.organisations ?? [],
    state_id: r.state_id,
    joined_at: toIso(r.joined_at),
    first_sign_in_at: r.first_sign_in_at ? toIso(r.first_sign_in_at) : null,
    last_active_at: r.last_seen_at ? toIso(r.last_seen_at) : null,
    status,
    verification: r.verification,
    phone_verified: r.phone_verified === true,
    publication: r.publication,
    advisory:
      r.kind === 'organisation'
        ? 'none'
        : advisoryStatusOf({
            provider_status: r.provider_status,
            adviser_approved: r.adviser_approved,
            application_status: r.application_status,
          }),
  };
}
