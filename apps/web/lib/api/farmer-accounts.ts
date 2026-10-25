import { PROFILE_FIELD_NAMES, toIso, type FarmerSelfRegister } from '@agri-erp/shared';

import { type AuditTx } from './audit';
import { notFound } from './errors';
import { UUID_PATTERN } from './buyer-presenters';

/**
 * B14 -- what the farmer routes share. A farmer reads and writes ONLY their own
 * record, listings and the requests buyers sent them: every query here takes
 * the farmer id from the session (`farmerScope`), never from the request.
 */

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

// ---------------------------------------------------------------------------
// THE PROFILE -- CORWADO's registration form, sections B to F and H
// ---------------------------------------------------------------------------

/** The profile columns, in PROFILE_FIELD_NAMES order: the name IS the column. */
const PROFILE_CASTS: Partial<Record<string, string>> = {
  date_of_birth: '::date',
  primary_crops: '::text[]',
  services_wanted: '::text[]',
  land_size: '::numeric',
};

export async function insertProfile(
  tx: AuditTx,
  farmerId: string,
  body: Partial<FarmerSelfRegister>,
): Promise<void> {
  const columns = PROFILE_FIELD_NAMES.filter((name) => body[name] !== undefined);
  const values = columns.map((name) => body[name] ?? null);
  const placeholders = columns.map((name, i) => `$${i + 2}${PROFILE_CASTS[name] ?? ''}`);
  await tx.$executeRawUnsafe(
    `INSERT INTO public.farmer_profile (farmer_id${columns.map((c) => `, ${c}`).join('')})
     VALUES ($1::uuid${placeholders.map((p) => `, ${p}`).join('')})`,
    farmerId,
    ...values,
  );
}

// ---------------------------------------------------------------------------
// THE FARMER'S OWN RECORD
// ---------------------------------------------------------------------------

interface SelfRow {
  id: string;
  farmer_number: string;
  given_name: string;
  family_name: string;
  // 2026-10-28: null for a self-registered account that has not given them.
  sex: string | null;
  year_of_birth: number | null;
  phone: string;
  payam_id: string | null;
  county_id: string | null;
  state_id: string | null;
  payam_name: string | null;
  registration_source: string;
  verification_status: string;
  consent_id: string;
  consent_language: string | null;
  created_at: Date;
  village: string | null;
  primary_crops: string[] | null;
}

export async function loadSelf(db: Db, farmerId: string) {
  const [row] = await db.$queryRawUnsafe<SelfRow[]>(
    `SELECT f.id, f.farmer_number, f.given_name, f.family_name, f.sex::text AS sex,
            f.year_of_birth, f.phone, f.payam_id, f.county_id, f.state_id, pm.name AS payam_name,
            f.registration_source::text AS registration_source,
            f.verification_status::text AS verification_status, f.consent_id,
            c.language::text AS consent_language, f.created_at,
            p.village, p.primary_crops
       FROM public.farmer_active f
       LEFT JOIN public.payam pm ON pm.id = f.payam_id
       LEFT JOIN public.consent c ON c.id = f.consent_id
       LEFT JOIN public.farmer_profile p ON p.farmer_id = f.id
      WHERE f.id = $1::uuid`,
    farmerId,
  );
  if (!row) throw notFound();
  return {
    id: row.id,
    farmer_number: row.farmer_number,
    given_name: row.given_name,
    family_name: row.family_name,
    sex: row.sex,
    year_of_birth: row.year_of_birth,
    phone: row.phone,
    payam_id: row.payam_id,
    payam_name: row.payam_name,
    county_id: row.county_id,
    state_id: row.state_id,
    registration_source: row.registration_source,
    verification_status: row.verification_status,
    consent_id: row.consent_id,
    preferred_language: row.consent_language,
    village: row.village,
    primary_crops: row.primary_crops ?? [],
    created_at: toIso(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// THE FARMER'S OWN LISTINGS
// ---------------------------------------------------------------------------

export const OWN_LISTING_COLUMNS = `id, farmer_id, trading_name, title,
  category::text AS category, product_name, description,
  quantity::text AS quantity, unit::text AS unit,
  price_ssp::text AS price_ssp, price_per::text AS price_per,
  negotiable, delivery_available,
  to_char(available_from, 'YYYY-MM-DD') AS available_from,
  CASE WHEN available_until IS NULL THEN NULL ELSE to_char(available_until, 'YYYY-MM-DD') END AS available_until,
  harvest_season, pickup_notes, contact_phone, show_phone, photo_storage_paths,
  quality_grade::text AS quality_grade, min_order_quantity::text AS min_order_quantity,
  quantity_sold::text AS quantity_sold, organization_id,
  status::text AS status, created_at, updated_at`;

export interface OwnListingRow {
  id: string;
  farmer_id: string;
  trading_name: string;
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
  pickup_notes: string | null;
  contact_phone: string;
  show_phone: boolean;
  photo_storage_paths: string[];
  quality_grade: string | null;
  min_order_quantity: string | null;
  /** LISTINGS LANE (2026-10-19): sold so far; what is left is quantity - quantity_sold. */
  quantity_sold: string;
  /** 2026-10-28: the organisation it was posted for, or null for the farmer's own. */
  organization_id: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

/** The farmer's own listing, in the shape the farmer screens already read. */
export const presentOwnListing = (row: OwnListingRow) => ({
  ...row,
  quantity: Number(row.quantity),
  price_ssp: Number(row.price_ssp),
  min_order_quantity: row.min_order_quantity === null ? null : Number(row.min_order_quantity),
  quantity_sold: Number(row.quantity_sold),
  created_at: toIso(row.created_at),
  updated_at: toIso(row.updated_at),
});

/**
 * 2026-10-28 (user journeys, team access follow-up): which listings are the
 * caller's own, over the bare produce_listing table with ONE placeholder,
 * exactly as ownerWhere does for buying requests and services. Acting for an
 * organisation (with listings.manage, checked by actingWith): that
 * organisation's listings, whoever posted them. Otherwise: the farmer's own
 * listings made for themselves. Personal and organisational listings stay apart.
 */
export const ownListingWhere = (organizationId: string | null, param: string): string =>
  organizationId
    ? `organization_id = ${param}::uuid`
    : `farmer_id = ${param}::uuid AND organization_id IS NULL`;

export async function loadOwnListing(
  db: Db,
  farmerId: string,
  id: string,
  lock = false,
  organizationId: string | null = null,
) {
  if (!UUID_PATTERN.test(id)) throw notFound();
  const [row] = await db.$queryRawUnsafe<OwnListingRow[]>(
    `SELECT ${OWN_LISTING_COLUMNS} FROM public.produce_listing
      WHERE id = $1::uuid AND ${ownListingWhere(organizationId, '$2')} AND deleted_at IS NULL
      ${lock ? 'FOR UPDATE' : ''}`,
    id,
    organizationId ?? farmerId,
  );
  if (!row) throw notFound();
  return row;
}

// ---------------------------------------------------------------------------
// REQUESTS BUYERS SENT THE FARMER
// ---------------------------------------------------------------------------

/**
 * A request on one of the farmer's listings. The farmer is given the buyer's
 * name and phone -- the owner's decision is that the two deal directly, and
 * the buyer is given the farmer's number in turn once they have asked.
 * Drafts are excluded: a draft has not been sent.
 */
export const INCOMING_COLUMNS = `r.id, r.listing_id, pl.title AS listing_title, r.product_name,
  r.quantity::text AS quantity, r.unit::text AS unit, r.delivery_location,
  CASE WHEN r.required_by IS NULL THEN NULL ELSE to_char(r.required_by, 'YYYY-MM-DD') END AS required_by,
  r.notes, r.status::text AS status, r.submitted_at, r.decision_note, r.decided_at,
  b.given_name || ' ' || b.family_name AS buyer_name, b.phone AS buyer_phone,
  o.name AS organization_name, o.account_type::text AS account_type`;

export const INCOMING_FROM = `FROM public.purchase_request r
  JOIN public.produce_listing pl ON pl.id = r.listing_id
  JOIN public.buyer b ON b.id = r.created_by
  JOIN public.buyer_organization o ON o.id = r.organization_id`;

export const INCOMING_WHERE = `pl.farmer_id = $1::uuid AND r.deleted_at IS NULL AND r.status <> 'draft'`;

export interface IncomingRow {
  id: string;
  listing_id: string;
  listing_title: string;
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
  buyer_name: string;
  buyer_phone: string;
  organization_name: string;
  account_type: string;
}

export const presentIncoming = (row: IncomingRow) => ({
  id: row.id,
  listing_id: row.listing_id,
  listing_title: row.listing_title,
  product_name: row.product_name,
  quantity: Number(row.quantity),
  unit: row.unit,
  delivery_location: row.delivery_location,
  required_by: row.required_by,
  notes: row.notes,
  status: row.status,
  submitted_at: row.submitted_at ? toIso(row.submitted_at) : null,
  answer_note: row.decision_note,
  answered_at: row.decided_at ? toIso(row.decided_at) : null,
  buyer: {
    name: row.buyer_name,
    phone: row.buyer_phone,
    // A business buyer's organisation; an individual's account carries their own name.
    organization: row.account_type === 'business' ? row.organization_name : null,
  },
});
