import { createHash } from 'node:crypto';

import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MARKET_POST_MESSAGES,
  canMove,
  canonicalStatus,
  encodeCursor,
  toIso,
  zodErrorToApiError,
  type MarketReportTarget,
  type SubmitProductReport,
} from '@agri-erp/shared';

import { audited, writeAudit, type AuditTx } from './audit';
import { ApiFailure, forbidden, invalidCursor, notFound, unprocessable } from './errors';
import { type Authenticated } from './require-role';
import { UUID_PATTERN } from './buyer-presenters';
import { PUBLIC_PROFILE_WHERE } from './public-profile-sql';
import { prisma } from '../db';

/**
 * LISTINGS LANE (2026-10-19) -- what the buying-request, service-listing and
 * market-report routes share. docs/DECISIONS.md, "Listings: no verification
 * gate, one lifecycle, buying requests and services".
 *
 * THE PRIVACY LINE. A public read never carries a phone number, a farmer or
 * buyer id, or a legal name: the poster is the name they chose for the market.
 * The contact phone is returned only by the `/contact` routes, to a signed-in
 * farmer or buyer, and to the owner on their own records.
 */

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

// ---------------------------------------------------------------------------
// REQUEST PLUMBING
// ---------------------------------------------------------------------------

/** A query string through a shared schema; an unknown filter is a 400, not ignored. */
interface QuerySchema<T> {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: Parameters<typeof zodErrorToApiError>[0] };
}

export function parseQuery<T>(request: Request, schema: QuerySchema<T>): T {
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const { body } = zodErrorToApiError(parsed.error);
    throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
  }
  return parsed.data;
}

export function pageLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw invalidCursor();
  return Math.min(n, MAX_LIMIT);
}

/** One failing field, in the documented 400 shape. */
export const invalidField = (field: string, reason: string) =>
  new ApiFailure(400, 'invalid_input', 'Some of the information sent was not valid.', {
    [field]: reason,
  });

export const likePattern = (q: string) => `%${q.replace(/[%_\\]/g, '\\$&')}%`;

export const cursorOf = (row: { updated_at: Date; id: string }) =>
  encodeCursor({ createdAt: row.updated_at.toISOString(), id: row.id });

/** Today in UTC, as the database's current_date is on Supabase. */
export const todayUtc = () => new Date().toISOString().slice(0, 10);

/** A malformed id is a missing record, never a database error. */
export function checkId(id: string | undefined): string {
  if (!id || !UUID_PATTERN.test(id)) throw notFound();
  return id;
}

// ---------------------------------------------------------------------------
// WHO IS POSTING -- from the session, never from the body
// ---------------------------------------------------------------------------

/**
 * The poster of a buying request: the signed-in farmer or buyer account.
 * Another session is making one account able to both buy and sell; this is
 * the one place that reads the scope, so that change lands here alone.
 */
export type Poster =
  | { type: 'farmer'; id: string; column: 'farmer_id' }
  | { type: 'buyer'; id: string; column: 'buyer_id' };

export function marketPoster(auth: Authenticated): Poster {
  if (auth.scope.kind === 'farmer')
    return { type: 'farmer', id: auth.scope.farmerId, column: 'farmer_id' };
  if (auth.scope.kind === 'buyer')
    return { type: 'buyer', id: auth.scope.buyerId, column: 'buyer_id' };
  throw forbidden();
}

/** The poster's own phone: the default contact for something they post. */
export async function posterPhone(db: Db, poster: Poster): Promise<string> {
  const [row] = await db.$queryRawUnsafe<{ phone: string }[]>(
    poster.type === 'farmer'
      ? 'SELECT phone FROM public.farmer_active WHERE id = $1::uuid'
      : 'SELECT phone FROM public.buyer_active WHERE id = $1::uuid',
    poster.id,
  );
  if (!row) throw notFound();
  return row.phone;
}

// ---------------------------------------------------------------------------
// THE LIFECYCLE ON A WRITE
// ---------------------------------------------------------------------------

/**
 * Checks a status move and an end date together, before anything is written.
 * Going live (or staying live) with an end date already past is refused with
 * the field to fix: renewing is giving a new date.
 */
export function checkLifecycle(input: {
  from: string;
  to: string | undefined;
  endField: string;
  endDate: string | null;
  endChanged: boolean;
  today: string;
}): void {
  const { from, to, endField, endDate, endChanged, today } = input;
  if (to !== undefined && !canMove(from, to)) throw unprocessable('transition_not_allowed');
  const after = canonicalStatus(to ?? from);
  // An edit that leaves an expired post as it is keeps it expired; going live
  // (publish, resume) or renewing is what needs a date from today.
  const moved = to !== undefined && canonicalStatus(to) !== canonicalStatus(from);
  const goingLive = after === 'active' && (moved || endChanged);
  if (goingLive && endDate !== null && endDate < today) {
    throw invalidField(endField, MARKET_POST_MESSAGES.dateInPast);
  }
}

// ---------------------------------------------------------------------------
// BUYING REQUESTS
// ---------------------------------------------------------------------------

export const BUYING_REQUEST_COLUMNS = `br.id, br.poster_type, br.display_name,
  br.category::text AS category, br.product_name, br.quantity::text AS quantity,
  br.unit::text AS unit, br.state_id, s.name AS state_name, br.location,
  to_char(br.needed_by, 'YYYY-MM-DD') AS needed_by,
  br.price_ssp::text AS price_ssp, br.price_per::text AS price_per, br.negotiable,
  br.delivery_terms, br.description, br.status, br.created_at, br.updated_at, br.show_phone,
  (COALESCE(f.verification_status::text, '') = 'verified'
    OR COALESCE(o.verification_status::text, '') = 'verified') AS poster_verified,
  COALESCE((SELECT ap.allow_messages FROM public.account_profile ap
             WHERE ap.auth_user_id = COALESCE(f.auth_user_id, b.auth_user_id)), true)
    AS owner_messages`;

/** The poster must still exist: a removed farmer or buyer takes their requests with them. */
export const BUYING_REQUEST_FROM = `FROM public.buying_request_active br
  JOIN public.state s ON s.id = br.state_id
  LEFT JOIN public.farmer_active f ON f.id = br.farmer_id AND f.suspended_at IS NULL
  LEFT JOIN public.buyer_active b ON b.id = br.buyer_id AND b.suspended_at IS NULL
  LEFT JOIN public.buyer_organization_active o ON o.id = b.organization_id`;

export const BUYING_REQUEST_POSTER_LIVE = `(f.id IS NOT NULL OR b.id IS NOT NULL)`;

/** On the public market: active, not past its date, its poster still here. */
export const BUYING_REQUEST_MARKET_WHERE = `br.status = 'active' AND br.needed_by >= current_date
  AND ${BUYING_REQUEST_POSTER_LIVE}`;

export interface BuyingRequestRow {
  id: string;
  poster_type: string;
  display_name: string;
  category: string;
  product_name: string;
  quantity: string;
  unit: string;
  state_id: string;
  state_name: string;
  location: string;
  needed_by: string;
  price_ssp: string | null;
  price_per: string | null;
  negotiable: boolean;
  delivery_terms: string | null;
  description: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  show_phone: boolean;
  poster_verified: boolean;
  /** 2026-10-23: the poster's "Allow in-app messaging" (absent: on). */
  owner_messages?: boolean;
}

/** THE ONLY SHAPE A BUYING REQUEST TAKES ON THE PUBLIC MARKET. A whitelist. */
export const presentBuyingRequest = (row: BuyingRequestRow) => ({
  id: row.id,
  poster_type: row.poster_type,
  display_name: row.display_name,
  poster_verified: row.poster_verified,
  category: row.category,
  product_name: row.product_name,
  quantity: Number(row.quantity),
  unit: row.unit,
  state_id: row.state_id,
  state_name: row.state_name,
  location: row.location,
  needed_by: row.needed_by,
  price_ssp: row.price_ssp === null ? null : Number(row.price_ssp),
  price_per: row.price_per,
  negotiable: row.negotiable,
  delivery_terms: row.delivery_terms,
  description: row.description,
  // 2026-10-20: whether the poster offers their phone (a yes/no, never the number).
  phone_shared: row.show_phone,
  // 2026-10-23: whether the poster takes in-app messages (their profile's choice).
  messages_allowed: row.owner_messages ?? true,
  status: row.status,
  created_at: toIso(row.created_at),
  updated_at: toIso(row.updated_at),
});

/** The owner's own copy: the public shape plus the contact phone they set. */
export const OWN_BUYING_REQUEST_COLUMNS = `${BUYING_REQUEST_COLUMNS}, br.contact_phone`;

export const presentOwnBuyingRequest = (row: BuyingRequestRow & { contact_phone: string }) => ({
  ...presentBuyingRequest(row),
  contact_phone: row.contact_phone,
  show_phone: row.show_phone,
});

export async function loadOwnBuyingRequest(db: Db, poster: Poster, id: string, lock = false) {
  checkId(id);
  // The row is locked on its table, not through the view and its joins.
  if (lock) {
    await db.$queryRawUnsafe(
      `SELECT id FROM public.buying_request
        WHERE id = $1::uuid AND ${poster.column} = $2::uuid FOR UPDATE`,
      id,
      poster.id,
    );
  }
  const [row] = await db.$queryRawUnsafe<(BuyingRequestRow & { contact_phone: string })[]>(
    `SELECT ${OWN_BUYING_REQUEST_COLUMNS} ${BUYING_REQUEST_FROM}
      WHERE br.id = $1::uuid AND br.${poster.column} = $2::uuid`,
    id,
    poster.id,
  );
  if (!row) throw notFound();
  return row;
}

// ---------------------------------------------------------------------------
// SERVICE LISTINGS
// ---------------------------------------------------------------------------

export const SERVICE_COLUMNS = `sl.id, sl.trading_name, sl.service_type, sl.title, sl.description,
  sl.location, sl.payam_id, pm.name AS payam_name, sl.state_id, s.name AS state_name,
  to_char(sl.available_from, 'YYYY-MM-DD') AS available_from,
  CASE WHEN sl.available_until IS NULL THEN NULL
       ELSE to_char(sl.available_until, 'YYYY-MM-DD') END AS available_until,
  sl.availability_note, sl.price_ssp::text AS price_ssp, sl.price_unit, sl.negotiable,
  sl.status, sl.created_at, sl.updated_at, sl.show_phone,
  (f.verification_status::text = 'verified') AS farmer_verified,
  COALESCE((SELECT ap.allow_messages FROM public.account_profile ap
             WHERE ap.auth_user_id = f.auth_user_id), true) AS owner_messages`;

export const SERVICE_FROM = `FROM public.service_listing_active sl
  JOIN public.farmer_active f ON f.id = sl.farmer_id AND f.suspended_at IS NULL
  JOIN public.payam pm ON pm.id = sl.payam_id
  JOIN public.state s ON s.id = sl.state_id`;

export const SERVICE_MARKET_WHERE = `sl.status = 'active'
  AND (sl.available_until IS NULL OR sl.available_until >= current_date)`;

export interface ServiceRow {
  id: string;
  trading_name: string;
  service_type: string;
  title: string;
  description: string;
  location: string;
  payam_id: string;
  payam_name: string;
  state_id: string;
  state_name: string;
  available_from: string;
  available_until: string | null;
  availability_note: string | null;
  price_ssp: string | null;
  price_unit: string | null;
  negotiable: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
  show_phone: boolean;
  farmer_verified: boolean;
  /** 2026-10-23: the provider's "Allow in-app messaging" (absent: on). */
  owner_messages?: boolean;
}

/** THE ONLY SHAPE A SERVICE LISTING TAKES ON THE PUBLIC MARKET. A whitelist. */
export const presentService = (row: ServiceRow) => ({
  id: row.id,
  trading_name: row.trading_name,
  farmer_verified: row.farmer_verified,
  service_type: row.service_type,
  title: row.title,
  description: row.description,
  location: row.location,
  payam_name: row.payam_name,
  state_id: row.state_id,
  state_name: row.state_name,
  available_from: row.available_from,
  available_until: row.available_until,
  availability_note: row.availability_note,
  price_ssp: row.price_ssp === null ? null : Number(row.price_ssp),
  price_unit: row.price_unit,
  negotiable: row.negotiable,
  phone_shared: row.show_phone,
  messages_allowed: row.owner_messages ?? true,
  status: row.status,
  created_at: toIso(row.created_at),
  updated_at: toIso(row.updated_at),
});

export const OWN_SERVICE_COLUMNS = `${SERVICE_COLUMNS}, sl.contact_phone`;

export const presentOwnService = (row: ServiceRow & { contact_phone: string }) => ({
  ...presentService(row),
  contact_phone: row.contact_phone,
  show_phone: row.show_phone,
});

export async function loadOwnService(db: Db, farmerId: string, id: string, lock = false) {
  checkId(id);
  if (lock) {
    await db.$queryRawUnsafe(
      `SELECT id FROM public.service_listing
        WHERE id = $1::uuid AND farmer_id = $2::uuid FOR UPDATE`,
      id,
      farmerId,
    );
  }
  const [row] = await db.$queryRawUnsafe<(ServiceRow & { contact_phone: string })[]>(
    `SELECT ${OWN_SERVICE_COLUMNS} ${SERVICE_FROM}
      WHERE sl.id = $1::uuid AND sl.farmer_id = $2::uuid`,
    id,
    farmerId,
  );
  if (!row) throw notFound();
  return row;
}

// ---------------------------------------------------------------------------
// REPORTS -- the product-report mechanism for the two new kinds of post
// ---------------------------------------------------------------------------

const REPORT_TARGET: Record<MarketReportTarget, { visible: string; column: string }> = {
  buying_request: {
    visible: `SELECT br.id ${BUYING_REQUEST_FROM} WHERE br.id = $1::uuid AND ${BUYING_REQUEST_MARKET_WHERE}`,
    column: 'buying_request_id',
  },
  service_listing: {
    visible: `SELECT sl.id ${SERVICE_FROM} WHERE sl.id = $1::uuid AND ${SERVICE_MARKET_WHERE}`,
    column: 'service_listing_id',
  },
  // 2026-10-23: a published public profile, by its public id.
  profile: {
    visible: `SELECT ap.public_id AS id FROM public.account_profile ap
      WHERE ap.public_id = $1::uuid AND ${PUBLIC_PROFILE_WHERE}`,
    column: 'profile_id',
  },
};

/**
 * A marketplace visitor reports a buying request or a service listing.
 * Exactly the rules of POST /api/listings/:id/reports: nothing about the
 * person is stored; the digest refuses a repeat from the same source and is
 * NOT a rate limiter (there is no rate-limiting infrastructure in this
 * application); something not on the market is 404.
 */
export async function submitMarketReport(
  target: MarketReportTarget,
  rawId: string | undefined,
  body: SubmitProductReport,
  request: Request,
): Promise<{ received: true; id: string }> {
  const id = checkId(rawId);
  const spec = REPORT_TARGET[target];
  const [visible] = await prisma.$queryRawUnsafe<{ id: string }[]>(spec.visible, id);
  if (!visible) throw notFound();

  const source = request.headers.get('x-forwarded-for') ?? 'unknown';
  const digest = createHash('sha256').update(`${source}:${target}:${id}`).digest('hex');
  const [existing] = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM public.market_report_active
      WHERE ${spec.column} = $1::uuid AND submission_digest = $2 LIMIT 1`,
    id,
    digest,
  );
  if (existing) {
    throw new ApiFailure(
      409,
      'report_already_submitted',
      'This listing has already been reported from here. It is with the programme team.',
    );
  }

  const report = await audited(prisma, async (tx) => {
    const [row] = await tx.$queryRawUnsafe<{ id: string; status: string }[]>(
      `INSERT INTO public.market_report
         (target_type, ${spec.column}, reason, description, submission_digest)
       VALUES ($1, $2::uuid, $3::public.report_reason, $4, $5)
       RETURNING id, status::text AS status`,
      target,
      id,
      body.reason,
      body.description ?? null,
      digest,
    );
    if (!row) throw new ApiFailure(500, 'empty', 'The report could not be recorded.');
    await writeAudit(tx, {
      entityType: 'market_report',
      entityId: row.id,
      actorType: 'system',
      actorId: null,
      action: 'product_report.created',
      // The free-text description never enters the log (C-4.7).
      after: { target_type: target, target_id: id, reason: body.reason, status: row.status },
    });
    return row;
  });
  return { received: true, id: report.id };
}

// ---------------------------------------------------------------------------
// THE ADMINISTRATOR'S QUEUE -- never the reporter, never the digest
// ---------------------------------------------------------------------------

export interface MarketReportRow {
  id: string;
  target_type: string;
  target_id: string;
  reason: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  target_title: string | null;
  poster_name: string | null;
  target_status: string | null;
}

export const MARKET_REPORT_SELECT = `SELECT r.id, r.target_type,
        COALESCE(r.buying_request_id, r.service_listing_id, r.profile_id) AS target_id,
        r.reason::text AS reason, r.status::text AS status, r.created_at, r.updated_at,
        COALESCE(br.product_name, sl.title, rp.display_name) AS target_title,
        COALESCE(br.display_name, sl.trading_name, rp.display_name) AS poster_name,
        COALESCE(br.status, sl.status, rp.status) AS target_status
   FROM public.market_report_active r
   LEFT JOIN public.buying_request_active br ON br.id = r.buying_request_id
   LEFT JOIN public.service_listing_active sl ON sl.id = r.service_listing_id
   LEFT JOIN public.account_profile rp ON rp.public_id = r.profile_id`;
