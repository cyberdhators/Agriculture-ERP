import {
  type AdminMarketplaceItem,
  type AdminMarketplaceQuery,
  type MarketplaceKind,
  type MarketplaceStatus,
  type RemovedMarketplaceItem,
  type TabSelection,
  tabSelection,
  toIso,
} from '@agri-erp/shared';

/**
 * THE MARKETPLACE CONSOLE'S SQL (2026-10-28). docs/DECISIONS.md, "The staff
 * marketplace console".
 *
 * Pure text and pure functions -- no database import -- so the filter
 * building is tested without one (admin-marketplace.test.ts).
 *
 * THIS IS A STAFF READ, NOT THE MARKET. The market leaves out a suspended
 * account's posts; the console shows them, flagged `owner.suspended`, because
 * a moderator inspecting an account's posts needs to see them. Drafts are
 * never shown (they are the owner's own), and nothing soft-deleted is read:
 * a removed post appears only through the audit trail (REMOVED_SQL).
 */

/** The table each kind of post lives in. */
export const KIND_TABLE: Record<MarketplaceKind, string> = {
  produce_listing: 'produce_listing',
  buying_request: 'buying_request',
  service_listing: 'service_listing',
};

/**
 * The status staff read, in SQL: the twin of `marketplaceStatus` in
 * packages/shared. `expired` is a live post whose end date is before today.
 */
const statusCase = (stored: string, end: string) => `CASE
      WHEN ${stored} IN ('listed', 'active') AND ${end} IS NOT NULL AND ${end} < current_date
        THEN 'expired'
      WHEN ${stored} IN ('listed', 'active') THEN 'active'
      WHEN ${stored} IN ('sold', 'completed') THEN 'completed'
      ELSE ${stored} END`;

/**
 * One SELECT per kind, every one with the same columns. Owner joins use the
 * aliases `fo` / `bo` (not the market's `f` / `b`): this read deliberately
 * keeps a suspended owner's posts.
 */
export const KIND_SQL: Record<MarketplaceKind, string> = {
  produce_listing: `SELECT 'produce_listing'::text AS kind, pl.id, pl.title,
       pl.category::text AS category, pl.product_name AS product,
       pl.state_id, s.name AS state_name,
       ${statusCase('pl.status::text', 'pl.available_until')} AS status,
       CASE WHEN pl.available_until IS NULL THEN NULL
            ELSE to_char(pl.available_until, 'YYYY-MM-DD') END AS end_date,
       pl.created_at, pl.updated_at,
       'farmer'::text AS owner_kind,
       CASE WHEN fo.deleted_at IS NULL THEN pl.farmer_id END AS owner_id,
       pl.trading_name AS owner_name,
       (fo.suspended_at IS NOT NULL) AS owner_suspended,
       NULL::uuid AS organization_id, NULL::text AS organization_name,
       EXISTS (SELECT 1 FROM public.listing_correction c
                WHERE c.produce_listing_id = pl.id AND c.status = 'open'
                  AND c.deleted_at IS NULL) AS open_correction,
       (SELECT count(*)::int FROM public.product_report r
         WHERE r.listing_id = pl.id AND r.status IN ('new', 'reviewing')
           AND r.deleted_at IS NULL) AS open_reports
  FROM public.produce_listing pl
  JOIN public.state s ON s.id = pl.state_id
  LEFT JOIN public.farmer fo ON fo.id = pl.farmer_id
 WHERE pl.deleted_at IS NULL AND pl.status <> 'draft'`,

  buying_request: `SELECT 'buying_request'::text AS kind, br.id, br.product_name AS title,
       br.category::text AS category, br.product_name AS product,
       br.state_id, s.name AS state_name,
       ${statusCase('br.status', 'br.needed_by')} AS status,
       to_char(br.needed_by, 'YYYY-MM-DD') AS end_date,
       br.created_at, br.updated_at,
       br.poster_type AS owner_kind,
       CASE WHEN br.poster_type = 'farmer' AND fo.deleted_at IS NULL THEN br.farmer_id
            WHEN br.poster_type = 'buyer' AND bo.deleted_at IS NULL THEN br.buyer_id END AS owner_id,
       br.display_name AS owner_name,
       (COALESCE(fo.suspended_at, bo.suspended_at) IS NOT NULL) AS owner_suspended,
       og.id AS organization_id, og.name AS organization_name,
       EXISTS (SELECT 1 FROM public.listing_correction c
                WHERE c.buying_request_id = br.id AND c.status = 'open'
                  AND c.deleted_at IS NULL) AS open_correction,
       (SELECT count(*)::int FROM public.market_report r
         WHERE r.buying_request_id = br.id AND r.status IN ('new', 'reviewing')
           AND r.deleted_at IS NULL) AS open_reports
  FROM public.buying_request br
  JOIN public.state s ON s.id = br.state_id
  LEFT JOIN public.farmer fo ON fo.id = br.farmer_id
  LEFT JOIN public.buyer bo ON bo.id = br.buyer_id
  LEFT JOIN public.organization og ON og.id = br.organization_id AND og.deleted_at IS NULL
 WHERE br.deleted_at IS NULL AND br.status <> 'draft'`,

  service_listing: `SELECT 'service_listing'::text AS kind, sl.id, sl.title,
       sl.service_type AS category, sl.service_type AS product,
       sl.state_id, s.name AS state_name,
       ${statusCase('sl.status', 'sl.available_until')} AS status,
       CASE WHEN sl.available_until IS NULL THEN NULL
            ELSE to_char(sl.available_until, 'YYYY-MM-DD') END AS end_date,
       sl.created_at, sl.updated_at,
       sl.poster_type AS owner_kind,
       CASE WHEN sl.poster_type = 'farmer' AND fo.deleted_at IS NULL THEN sl.farmer_id
            WHEN sl.poster_type = 'buyer' AND bo.deleted_at IS NULL THEN sl.buyer_id END AS owner_id,
       sl.trading_name AS owner_name,
       (COALESCE(fo.suspended_at, bo.suspended_at) IS NOT NULL) AS owner_suspended,
       og.id AS organization_id, og.name AS organization_name,
       EXISTS (SELECT 1 FROM public.listing_correction c
                WHERE c.service_listing_id = sl.id AND c.status = 'open'
                  AND c.deleted_at IS NULL) AS open_correction,
       (SELECT count(*)::int FROM public.market_report r
         WHERE r.service_listing_id = sl.id AND r.status IN ('new', 'reviewing')
           AND r.deleted_at IS NULL) AS open_reports
  FROM public.service_listing sl
  JOIN public.state s ON s.id = sl.state_id
  LEFT JOIN public.farmer fo ON fo.id = sl.farmer_id
  LEFT JOIN public.buyer bo ON bo.id = sl.buyer_id
  LEFT JOIN public.organization og ON og.id = sl.organization_id AND og.deleted_at IS NULL
 WHERE sl.deleted_at IS NULL AND sl.status <> 'draft'`,
};

/** The union of the kinds a tab reads, as one derived table `p`. */
export const postsFrom = (kinds: readonly MarketplaceKind[]): string =>
  `(${kinds.map((k) => KIND_SQL[k]).join('\n UNION ALL\n')}) p`;

export interface BuiltQuery {
  readonly from: string;
  readonly where: readonly string[];
  readonly params: readonly unknown[];
}

/** Escapes a search for ILIKE, as lib/api/market-posts.ts likePattern does. */
const like = (q: string) => `%${q.replace(/[%_\\]/g, '\\$&')}%`;

/**
 * The FROM, WHERE and parameters for a tab and its filters. The cursor is
 * added by the route. An empty status selection (a live status asked of the
 * Inactive tab) matches nothing rather than everything.
 */
export function buildMarketplaceQuery(
  query: Pick<
    AdminMarketplaceQuery,
    'tab' | 'status' | 'kind' | 'q' | 'state_id' | 'category' | 'flag'
  >,
): BuiltQuery & { selection: TabSelection } {
  const selection = tabSelection(query);
  const params: unknown[] = [];
  const where: string[] = [];
  const push = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (selection.statuses.length === 0) where.push('false');
  else where.push(`p.status = ANY(${push([...selection.statuses])}::text[])`);

  if (selection.inputs === true) where.push(`p.category = 'seeds_inputs'`);
  if (selection.inputs === false) where.push(`p.category <> 'seeds_inputs'`);

  if (query.q) {
    const p = push(like(query.q));
    where.push(
      `(p.title ILIKE ${p} OR p.product ILIKE ${p} OR p.owner_name ILIKE ${p}
        OR p.organization_name ILIKE ${p})`,
    );
  }
  if (query.state_id) where.push(`p.state_id = ${push(query.state_id)}`);
  if (query.category) where.push(`p.category = ${push(query.category)}`);
  if (query.flag === 'reported') where.push('p.open_reports > 0');
  if (query.flag === 'correction') where.push('p.open_correction');

  return { selection, from: postsFrom(selection.kinds), where, params };
}

export interface MarketplaceRow {
  kind: MarketplaceKind;
  id: string;
  title: string;
  category: string;
  product: string;
  state_id: string;
  state_name: string;
  status: MarketplaceStatus;
  end_date: string | null;
  created_at: Date;
  updated_at: Date;
  owner_kind: 'farmer' | 'buyer';
  owner_id: string | null;
  owner_name: string;
  owner_suspended: boolean;
  organization_id: string | null;
  organization_name: string | null;
  open_correction: boolean;
  open_reports: number;
}

export const presentMarketplaceRow = (row: MarketplaceRow): AdminMarketplaceItem => ({
  kind: row.kind,
  id: row.id,
  title: row.title,
  category: row.category,
  product: row.product,
  state_id: row.state_id,
  state_name: row.state_name,
  status: row.status,
  end_date: row.end_date,
  created_at: toIso(row.created_at),
  updated_at: toIso(row.updated_at),
  owner: {
    kind: row.owner_kind,
    id: row.owner_id,
    name: row.owner_name,
    suspended: row.owner_suspended,
  },
  organization:
    row.organization_id && row.organization_name
      ? { id: row.organization_id, name: row.organization_name }
      : null,
  open_correction: row.open_correction,
  open_reports: Number(row.open_reports),
});

// ---------------------------------------------------------------------------
// REMOVED BY STAFF -- read from the audit trail, never from the removed rows
// ---------------------------------------------------------------------------

/** The two audit actions that record a staff removal of a post. */
export const REMOVAL_ACTIONS = ['listing.removed', 'product_report.listing_removed'] as const;

/**
 * Removals newest first. The post itself is soft-deleted and is NOT read (the
 * deletion law: soft-deleted rows appear in no list); what is listed is the
 * audit trail's record of each removal. The title is in the record for a
 * removal made from this console; a removal from a report's queue carries
 * only the post's id. The staff member's name is a staff account's.
 */
export const REMOVED_SQL = `SELECT ae.id AS audit_id, ae.entity_type AS kind, ae.entity_id AS id,
       ae.action, ae.after ->> 'title' AS title, ae.after ->> 'reason' AS reason,
       ae.after ->> 'reason_code' AS reason_code, ae.occurred_at AS removed_at,
       u.name AS removed_by
  FROM public.audit_event ae
  LEFT JOIN public."user" u ON u.id = ae.actor_id
 WHERE ae.action = ANY($1::text[])
   AND ae.entity_type IN ('produce_listing', 'buying_request', 'service_listing')`;

export interface RemovedRow {
  audit_id: string;
  kind: MarketplaceKind;
  id: string;
  action: string;
  title: string | null;
  reason: string | null;
  reason_code: string | null;
  removed_at: Date;
  removed_by: string | null;
}

export const presentRemovedRow = (row: RemovedRow): RemovedMarketplaceItem => ({
  audit_id: row.audit_id,
  kind: row.kind,
  id: row.id,
  title: row.title,
  reason: row.reason,
  reason_code: row.reason_code,
  via: row.action === 'listing.removed' ? 'console' : 'report',
  removed_at: toIso(row.removed_at),
  removed_by: row.removed_by,
});

// ---------------------------------------------------------------------------
// INSPECTING ONE POST
// ---------------------------------------------------------------------------

/**
 * Everything about a post that staff inspect, as one JSON object per kind.
 * NOT the contact phone (the owner's choice whether to show it is returned as
 * show_phone): moderation does not need it, and a staff screen is no reason
 * to spread a number further.
 */
export const DETAIL_SQL: Record<MarketplaceKind, string> = {
  produce_listing: `SELECT jsonb_build_object(
       'description', pl.description, 'product_name', pl.product_name,
       'quantity', pl.quantity::text, 'quantity_sold', pl.quantity_sold::text,
       'unit', pl.unit::text, 'price_ssp', pl.price_ssp::text, 'price_per', pl.price_per::text,
       'negotiable', pl.negotiable, 'quality_grade', pl.quality_grade::text,
       'min_order_quantity', pl.min_order_quantity::text,
       'available_from', to_char(pl.available_from, 'YYYY-MM-DD'),
       'harvest_season', pl.harvest_season, 'pickup_notes', pl.pickup_notes,
       'delivery_available', pl.delivery_available, 'show_phone', pl.show_phone,
       'payam', pm.name, 'photos', to_jsonb(pl.photo_storage_paths)) AS details
  FROM public.produce_listing pl
  LEFT JOIN public.payam pm ON pm.id = pl.payam_id
 WHERE pl.id = $1::uuid AND pl.deleted_at IS NULL`,
  buying_request: `SELECT jsonb_build_object(
       'description', br.description, 'quantity', br.quantity::text, 'unit', br.unit::text,
       'location', br.location, 'price_ssp', br.price_ssp::text, 'price_per', br.price_per::text,
       'negotiable', br.negotiable, 'delivery_terms', br.delivery_terms,
       'show_phone', br.show_phone) AS details
  FROM public.buying_request br
 WHERE br.id = $1::uuid AND br.deleted_at IS NULL`,
  service_listing: `SELECT jsonb_build_object(
       'description', sl.description, 'service_type', sl.service_type, 'location', sl.location,
       'payam', pm.name, 'available_from', to_char(sl.available_from, 'YYYY-MM-DD'),
       'availability_note', sl.availability_note, 'price_ssp', sl.price_ssp::text,
       'price_unit', sl.price_unit, 'negotiable', sl.negotiable,
       'show_phone', sl.show_phone) AS details
  FROM public.service_listing sl
  LEFT JOIN public.payam pm ON pm.id = sl.payam_id
 WHERE sl.id = $1::uuid AND sl.deleted_at IS NULL`,
};

/**
 * The reports about a post, newest first. The reporter is never named (no
 * report stores one); the description is returned, as the report detail
 * route returns it, because inspecting one post is a deliberate act.
 */
export const REPORTS_SQL: Record<MarketplaceKind, string> = {
  produce_listing: `SELECT r.id, r.reason::text AS reason, r.description, r.status::text AS status,
       r.created_at FROM public.product_report r
 WHERE r.listing_id = $1::uuid AND r.deleted_at IS NULL
 ORDER BY r.created_at DESC LIMIT 50`,
  buying_request: `SELECT r.id, r.reason::text AS reason, r.description, r.status::text AS status,
       r.created_at FROM public.market_report r
 WHERE r.buying_request_id = $1::uuid AND r.deleted_at IS NULL
 ORDER BY r.created_at DESC LIMIT 50`,
  service_listing: `SELECT r.id, r.reason::text AS reason, r.description, r.status::text AS status,
       r.created_at FROM public.market_report r
 WHERE r.service_listing_id = $1::uuid AND r.deleted_at IS NULL
 ORDER BY r.created_at DESC LIMIT 50`,
};

/** The kind named in an address, or null (the route answers 404). */
export const kindOf = (raw: string | undefined): MarketplaceKind | null =>
  raw === 'produce_listing' || raw === 'buying_request' || raw === 'service_listing' ? raw : null;

/**
 * The post a removal acts on, locked, with the account to tell. A draft is
 * the owner's own and cannot be removed by staff (404, as if absent).
 */
export const REMOVE_TARGET_SQL: Record<MarketplaceKind, string> = {
  produce_listing: `SELECT pl.title, pl.status::text AS status, pl.farmer_id AS owner_farmer_id,
       fo.auth_user_id AS owner_auth_user_id
  FROM public.produce_listing pl
  LEFT JOIN public.farmer fo ON fo.id = pl.farmer_id
 WHERE pl.id = $1::uuid AND pl.deleted_at IS NULL AND pl.status <> 'draft'
   FOR UPDATE OF pl`,
  buying_request: `SELECT br.product_name AS title, br.status, br.farmer_id AS owner_farmer_id,
       COALESCE(fo.auth_user_id, bo.auth_user_id) AS owner_auth_user_id
  FROM public.buying_request br
  LEFT JOIN public.farmer fo ON fo.id = br.farmer_id
  LEFT JOIN public.buyer bo ON bo.id = br.buyer_id
 WHERE br.id = $1::uuid AND br.deleted_at IS NULL AND br.status <> 'draft'
   FOR UPDATE OF br`,
  service_listing: `SELECT sl.title, sl.status, sl.farmer_id AS owner_farmer_id,
       COALESCE(fo.auth_user_id, bo.auth_user_id) AS owner_auth_user_id
  FROM public.service_listing sl
  LEFT JOIN public.farmer fo ON fo.id = sl.farmer_id
  LEFT JOIN public.buyer bo ON bo.id = sl.buyer_id
 WHERE sl.id = $1::uuid AND sl.deleted_at IS NULL AND sl.status <> 'draft'
   FOR UPDATE OF sl`,
};
