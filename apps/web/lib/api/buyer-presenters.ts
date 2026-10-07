import { encodeCursor } from '@agri-erp/shared';

/**
 * B13 -- THE SHAPES A BUYER IS GIVEN. Criteria C-14B.8.
 *
 * Kept apart from lib/api/buyers.ts, which talks to the database, so that a
 * pure test can import these and prove what a buyer never receives without a
 * database or a session.
 *
 * THE PRIVACY LINE IS DRAWN HERE, ONCE. A buyer is an outside party. These
 * presenters are the only shapes a buyer route returns, and each is a
 * whitelist: a column that is not named here cannot reach a buyer however a
 * query is later widened. What a buyer never receives, by construction:
 *
 *   - the farmer's id, legal name, phone, national id, sex or year of birth
 *   - the listing's contact phone and pickup notes (free text that carries both)
 *   - any coordinate, boundary or location finer than the payam's name
 *   - the photo storage paths (internal object keys)
 *   - officer, visit, verification-event or any other register record
 *   - any staff member's id; a recorder is "CORWADO" or "you"
 *
 * The supplier is described by the trading name the farmer chose to publish,
 * whether the farmer is verified, and the payam, county and state of the
 * listing -- what a procurement decision needs and no more.
 */

// ---------------------------------------------------------------------------
// THE MARKETPLACE
// ---------------------------------------------------------------------------

/**
 * The columns a buyer's marketplace query may select. Note what is absent:
 * farmer_id, contact_phone, pickup_notes, photo_storage_paths.
 */
export const MARKET_COLUMNS = `pl.id, pl.title, pl.category::text AS category, pl.product_name,
  pl.description, pl.quantity::text AS quantity, pl.unit::text AS unit,
  pl.price_ssp::text AS price_ssp, pl.price_per::text AS price_per, pl.negotiable,
  pl.delivery_available,
  to_char(pl.available_from, 'YYYY-MM-DD') AS available_from,
  CASE WHEN pl.available_until IS NULL THEN NULL
       ELSE to_char(pl.available_until, 'YYYY-MM-DD') END AS available_until,
  pl.harvest_season, pl.quality_grade::text AS quality_grade,
  pl.min_order_quantity::text AS min_order_quantity, pl.trading_name,
  pl.updated_at, f.verification_status::text AS supplier_verification,
  pm.name AS payam_name, c.id AS county_id, c.name AS county_name,
  s.id AS state_id, s.name AS state_name`;

/** Listed, not removed, with a seller who is not removed. */
export const MARKET_FROM = `FROM public.produce_listing_active pl
  JOIN public.farmer_active f ON f.id = pl.farmer_id
  JOIN public.payam pm ON pm.id = pl.payam_id
  JOIN public.county c ON c.id = pm.county_id
  JOIN public.state s ON s.id = pl.state_id`;

export const MARKET_BASE_WHERE = `pl.status = 'listed'`;

export interface MarketRow {
  id: string;
  title: string;
  category: string;
  product_name: string;
  description: string;
  quantity: string;
  unit: string;
  price_ssp: string;
  price_per: string;
  negotiable: boolean;
  delivery_available: boolean;
  available_from: string;
  available_until: string | null;
  harvest_season: string | null;
  quality_grade: string | null;
  min_order_quantity: string | null;
  trading_name: string;
  updated_at: Date;
  supplier_verification: string;
  payam_name: string;
  county_id: string;
  county_name: string;
  state_id: string;
  state_name: string;
}

/** THE ONLY SHAPE A LISTING TAKES ON ITS WAY TO A BUYER. A whitelist. */
export function presentMarketListing(row: MarketRow) {
  return {
    id: row.id,
    title: row.title,
    product_name: row.product_name,
    category: row.category,
    description: row.description,
    available_quantity: Number(row.quantity),
    unit: row.unit,
    // "Indicative": the farmer's asking price, which an order may differ from.
    indicative_price_ssp: Number(row.price_ssp),
    price_per: row.price_per,
    negotiable: row.negotiable,
    delivery_available: row.delivery_available,
    available_from: row.available_from,
    available_until: row.available_until,
    production_period: row.harvest_season,
    quality_grade: row.quality_grade,
    min_order_quantity: row.min_order_quantity === null ? null : Number(row.min_order_quantity),
    supplier: {
      trading_name: row.trading_name,
      verified: row.supplier_verification === 'verified',
    },
    location: {
      payam: row.payam_name,
      county_id: row.county_id,
      county: row.county_name,
      state_id: row.state_id,
      state: row.state_name,
    },
    updated_at: row.updated_at.toISOString(),
  };
}

export type BuyerMarketListing = ReturnType<typeof presentMarketListing>;

export const marketCursor = (row: MarketRow): string =>
  encodeCursor({ createdAt: row.updated_at.toISOString(), id: row.id });

// ---------------------------------------------------------------------------
// THE BUYER'S OWN RECORDS
// ---------------------------------------------------------------------------

export const REQUEST_COLUMNS = `r.id, r.listing_id, r.category::text AS category, r.product_name,
  r.quantity::text AS quantity, r.unit::text AS unit, r.delivery_location,
  CASE WHEN r.required_by IS NULL THEN NULL ELSE to_char(r.required_by, 'YYYY-MM-DD') END AS required_by,
  r.notes, r.status::text AS status, r.submitted_at, r.decision_note, r.decided_at,
  r.created_at, r.updated_at,
  b.given_name || ' ' || b.family_name AS created_by_name,
  pl.title AS listing_title,
  -- B14: the farmer's number, once the request has been sent (not a draft,
  -- not cancelled). Buyer and farmer deal directly (CORWADO, 2026-10-07).
  CASE WHEN r.status NOT IN ('draft', 'cancelled') THEN pl.contact_phone END AS farmer_phone`;

export const REQUEST_FROM = `FROM public.purchase_request r
  JOIN public.buyer b ON b.id = r.created_by
  LEFT JOIN public.produce_listing pl ON pl.id = r.listing_id`;

export interface RequestRow {
  id: string;
  listing_id: string | null;
  category: string;
  product_name: string;
  quantity: string;
  unit: string;
  delivery_location: string;
  required_by: string | null;
  notes: string | null;
  status: string;
  submitted_at: Date | null;
  decision_note: string | null;
  decided_at: Date | null;
  created_at: Date;
  updated_at: Date;
  created_by_name: string;
  listing_title: string | null;
  farmer_phone: string | null;
}

export function presentRequest(row: RequestRow) {
  return {
    id: row.id,
    listing_id: row.listing_id,
    listing_title: row.listing_title,
    category: row.category,
    product_name: row.product_name,
    quantity: Number(row.quantity),
    unit: row.unit,
    delivery_location: row.delivery_location,
    required_by: row.required_by,
    notes: row.notes,
    status: row.status,
    submitted_at: row.submitted_at?.toISOString() ?? null,
    decision_note: row.decision_note,
    decided_at: row.decided_at?.toISOString() ?? null,
    created_by_name: row.created_by_name,
    farmer_phone: row.farmer_phone,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export const ORDER_COLUMNS = `o.id, o.order_number, o.purchase_request_id, o.listing_id,
  o.category::text AS category, o.product_name, o.quantity::text AS quantity, o.unit::text AS unit,
  o.unit_price_ssp::text AS unit_price_ssp, o.total_ssp::text AS total_ssp,
  o.status::text AS status, o.delivery_location,
  CASE WHEN o.expected_delivery_date IS NULL THEN NULL
       ELSE to_char(o.expected_delivery_date, 'YYYY-MM-DD') END AS expected_delivery_date,
  o.cancel_reason, o.created_at, o.updated_at,
  pl.trading_name AS supplier_name, c.name AS supplier_county, s.name AS supplier_state`;

export const ORDER_FROM = `FROM public.purchase_order o
  JOIN public.produce_listing pl ON pl.id = o.listing_id
  JOIN public.payam pm ON pm.id = pl.payam_id
  JOIN public.county c ON c.id = pm.county_id
  JOIN public.state s ON s.id = pl.state_id`;

export interface OrderRow {
  id: string;
  order_number: string;
  purchase_request_id: string | null;
  listing_id: string;
  category: string;
  product_name: string;
  quantity: string;
  unit: string;
  unit_price_ssp: string;
  total_ssp: string;
  status: string;
  delivery_location: string;
  expected_delivery_date: string | null;
  cancel_reason: string | null;
  created_at: Date;
  updated_at: Date;
  supplier_name: string;
  supplier_county: string;
  supplier_state: string;
}

/** An order as a buyer sees it. The farmer behind the listing is never named. */
export function presentOrder(row: OrderRow) {
  return {
    id: row.id,
    order_number: row.order_number,
    purchase_request_id: row.purchase_request_id,
    listing_id: row.listing_id,
    category: row.category,
    product_name: row.product_name,
    quantity: Number(row.quantity),
    unit: row.unit,
    unit_price_ssp: Number(row.unit_price_ssp),
    total_ssp: Number(row.total_ssp),
    status: row.status,
    delivery_location: row.delivery_location,
    expected_delivery_date: row.expected_delivery_date,
    cancel_reason: row.cancel_reason,
    supplier: {
      trading_name: row.supplier_name,
      county: row.supplier_county,
      state: row.supplier_state,
    },
    order_date: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export interface DeliveryUpdateRow {
  id: string;
  order_id: string;
  status: string;
  note: string | null;
  by_buyer: boolean;
  occurred_at: Date;
}

/** A timeline entry. The recorder is "CORWADO" or "your organisation", never an id. */
export function presentDeliveryUpdate(row: DeliveryUpdateRow) {
  return {
    id: row.id,
    status: row.status,
    note: row.note,
    recorded_by: row.by_buyer ? ('buyer' as const) : ('corwado' as const),
    occurred_at: row.occurred_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// NOTIFICATION SENTENCES (C-14B.20)
// ---------------------------------------------------------------------------

/**
 * The fixed sentences a buyer is sent. Keyed, never composed: no farmer's or
 * staff member's name can reach a notification, and an order or request is
 * identified by what the buyer already knows of it.
 */
export const BUYER_NOTICES = {
  account_verified: {
    title: 'Your buyer account is verified',
    body: 'You can now send purchase requests from the marketplace.',
  },
  account_rejected: {
    title: 'Your buyer account was not approved',
    body: 'CORWADO could not verify your organisation. Open your profile to see the note.',
  },
  account_suspended: {
    title: 'Your buyer account is suspended',
    body: 'The marketplace is closed to your account. Contact CORWADO to resolve it.',
  },
  account_restored: {
    title: 'Your buyer account is active again',
    body: 'You can browse the marketplace and send purchase requests.',
  },
  account_under_review: {
    title: 'Your buyer account is under review',
    body: 'CORWADO is checking your organisation details.',
  },
  request_under_review: {
    title: 'A purchase request is under review',
    body: 'CORWADO is looking for suppliers for one of your requests.',
  },
  request_accepted: {
    title: 'A purchase request was accepted',
    body: 'CORWADO accepted one of your requests and will arrange an order.',
  },
  request_rejected: {
    title: 'A purchase request was declined',
    body: 'One of your requests could not be met. Open it to see the note.',
  },
  request_partially_fulfilled: {
    title: 'A purchase request is partly fulfilled',
    body: 'Part of one of your requests has been ordered.',
  },
  request_fulfilled: {
    title: 'A purchase request is fulfilled',
    body: 'One of your requests has been met in full.',
  },
  order_created: {
    title: 'A new order was arranged',
    body: 'CORWADO arranged an order for your organisation. Open Orders to see it.',
  },
  order_status_changed: {
    title: 'An order was updated',
    body: 'The status of one of your orders changed. Open Orders or Deliveries to see it.',
  },
} as const;

export type BuyerNotice = keyof typeof BUYER_NOTICES;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
