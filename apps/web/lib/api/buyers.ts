import {
  BUYER_MESSAGES,
  ERROR_CODES,
  buyerCapabilities,
  type BuyerVerificationStatus,
} from '@agri-erp/shared';

import { FARMER_CANCEL_NOTICE, FARMER_REQUEST_NOTICE } from '../farmer-notices';
import { writeAudit, type AuditTx } from './audit';
import {
  BUYER_NOTICES,
  ORDER_COLUMNS,
  ORDER_FROM,
  REQUEST_COLUMNS,
  REQUEST_FROM,
  UUID_PATTERN,
  presentDeliveryUpdate,
  type BuyerNotice,
  type DeliveryUpdateRow,
  type OrderRow,
  type RequestRow,
} from './buyer-presenters';
import { ApiFailure, RULE_MESSAGES, forbidden, notFound, unprocessable } from './errors';
import { type Authenticated } from './require-role';
import { buyerScope } from './scope';

/**
 * B13 -- what every buyer route shares that touches the database. Criteria
 * C-14B. The shapes a buyer is given, and why, are in ./buyer-presenters.ts.
 */
export * from './buyer-presenters';

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

// ---------------------------------------------------------------------------
// STANDING
// ---------------------------------------------------------------------------

/** The buyer's scope, refused unless their standing lets them browse. */
export function requireBrowse(auth: Authenticated) {
  const scope = buyerScope(auth);
  if (!buyerCapabilities(scope.verification).browse) throw forbidden();
  return scope;
}

/** The buyer's scope, refused unless verified. 422 so the screen can say why. */
export function requireVerified(auth: Authenticated) {
  const scope = buyerScope(auth);
  if (!buyerCapabilities(scope.verification).request) throw unprocessable('buyer_not_verified');
  return scope;
}

/**
 * The audit actor for a buyer. Every buyer write is recorded as the buyer row
 * that made it, never as the organisation, so two people at one organisation
 * remain distinguishable in the log.
 */
export const buyerActor = (auth: Authenticated) =>
  ({ actorType: 'buyer', actorId: auth.principal.id }) as const;

// ---------------------------------------------------------------------------
// OWNERSHIP IN THE QUERY (C-14B.22)
// ---------------------------------------------------------------------------

/**
 * One request, IF it belongs to the caller's organisation. Another
 * organisation's request is 404, exactly like one that never existed
 * (CONVENTIONS §5.1): a 403 would confirm the id is real.
 */
export async function loadOwnRequest(
  db: Db,
  organizationId: string,
  id: string,
  lock = false,
): Promise<RequestRow> {
  if (!UUID_PATTERN.test(id)) throw notFound();
  const [row] = await db.$queryRawUnsafe<RequestRow[]>(
    `SELECT ${REQUEST_COLUMNS} ${REQUEST_FROM}
      WHERE r.id = $1::uuid AND r.organization_id = $2::uuid AND r.deleted_at IS NULL
      ${lock ? 'FOR UPDATE OF r' : ''}`,
    id,
    organizationId,
  );
  if (!row) throw notFound();
  return row;
}

/** One order, IF it belongs to the caller's organisation; 404 otherwise. */
export async function loadOwnOrder(
  db: Db,
  organizationId: string,
  id: string,
  lock = false,
): Promise<OrderRow> {
  if (!UUID_PATTERN.test(id)) throw notFound();
  const [row] = await db.$queryRawUnsafe<OrderRow[]>(
    `SELECT ${ORDER_COLUMNS} ${ORDER_FROM}
      WHERE o.id = $1::uuid AND o.organization_id = $2::uuid AND o.deleted_at IS NULL
      ${lock ? 'FOR UPDATE OF o' : ''}`,
    id,
    organizationId,
  );
  if (!row) throw notFound();
  return row;
}

/** The timelines of the given orders, newest entry first. */
export async function deliveryUpdatesFor(
  db: Db,
  orderIds: readonly string[],
): Promise<Map<string, ReturnType<typeof presentDeliveryUpdate>[]>> {
  const out = new Map<string, ReturnType<typeof presentDeliveryUpdate>[]>();
  if (orderIds.length === 0) return out;
  const rows = await db.$queryRawUnsafe<DeliveryUpdateRow[]>(
    `SELECT id, order_id, status::text AS status, note,
            (recorded_by_buyer IS NOT NULL) AS by_buyer, occurred_at
       FROM public.delivery_update
      WHERE order_id = ANY($1::uuid[])
      ORDER BY occurred_at DESC, id DESC`,
    [...orderIds],
  );
  for (const row of rows) {
    const list = out.get(row.order_id) ?? [];
    list.push(presentDeliveryUpdate(row));
    out.set(row.order_id, list);
  }
  return out;
}

// ---------------------------------------------------------------------------
// NOTIFICATIONS (C-14B.20) -- the existing table, a buyer organisation as recipient
// ---------------------------------------------------------------------------

/**
 * Writes one in-app notification to an organisation, inside the caller's
 * audited transaction, and records that it was written. The actor is whoever
 * caused it -- the administrator who verified, the buyer who acted.
 */
export async function notifyOrganization(
  tx: AuditTx,
  organizationId: string,
  notice: BuyerNotice,
  actor: { actorType: 'admin' | 'supervisor' | 'buyer' | 'farmer'; actorId: string },
): Promise<void> {
  const { title, body } = BUYER_NOTICES[notice];
  const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO public.notification (buyer_organization_id, channel, title, body)
     VALUES ($1::uuid, 'in_app', $2, $3) RETURNING id`,
    organizationId,
    title,
    body,
  );
  await writeAudit(tx, {
    entityType: 'notification',
    entityId: row!.id,
    ...actor,
    action: 'notification.created',
    after: { recipient: 'buyer_organization', notice },
  });
}

/** The notice each verification decision sends, if any. */
export const NOTICE_FOR_STANDING: Partial<Record<BuyerVerificationStatus, BuyerNotice>> = {
  verified: 'account_verified',
  rejected: 'account_rejected',
  suspended: 'account_suspended',
  under_review: 'account_under_review',
  // An individual restored after a suspension or rejection.
  not_required: 'account_restored',
};

// ---------------------------------------------------------------------------
// B14 -- THE FARMER IS TOLD, AND THE TWO MAY CONTACT EACH OTHER
// ---------------------------------------------------------------------------

/**
 * The fixed sentence a farmer is sent when a buyer asks for their produce. The
 * text lives in lib/farmer-notices.ts with where tapping it goes (2026-10-10).
 */
export { FARMER_REQUEST_NOTICE };

/**
 * Tells the farmer behind a listing that a buyer has sent a request. Inside the
 * caller's audited transaction, recorded as the buyer's act. The sentence names
 * nobody; the dashboard shows the buyer's name and phone to the farmer.
 */
export async function notifyFarmerOfRequest(
  tx: AuditTx,
  listingId: string,
  actor: { actorType: 'buyer'; actorId: string },
): Promise<void> {
  const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO public.notification (farmer_id, channel, title, body)
     SELECT pl.farmer_id, 'in_app', $2, $3 FROM public.produce_listing pl WHERE pl.id = $1::uuid
     RETURNING id`,
    listingId,
    FARMER_REQUEST_NOTICE.title,
    FARMER_REQUEST_NOTICE.body,
  );
  if (!row) return;
  await writeAudit(tx, {
    entityType: 'notification',
    entityId: row.id,
    ...actor,
    action: 'notification.created',
    after: { recipient: 'farmer', notice: 'request_received' },
  });
}

/**
 * What a buyer asks for, checked against the listing it names, on the server
 * (2026-10-08; until then only the product page checked, and the cart route
 * accepted anything). Refuses, with a reason beside each line:
 *   - the same product twice in one cart;
 *   - more than the farmer listed, or below the minimum order -- compared only
 *     when the request is in the listing's own unit, since no conversion between
 *     units is known;
 *   - a product this organisation already has a request waiting on.
 * `field(i)` names where a line's reason goes: `items.<i>.quantity` for the
 * cart, `quantity` for a single request.
 */
export async function checkRequestedItems(
  db: Db,
  organizationId: string,
  items: readonly { listing_id: string; quantity: number; unit: string }[],
  field: (index: number) => string,
): Promise<void> {
  const reasons: Record<string, string> = {};
  const ids = [...new Set(items.map((i) => i.listing_id))];
  const listings = await db.$queryRawUnsafe<
    { id: string; quantity: number; unit: string; min_order: number | null }[]
  >(
    `SELECT id, quantity::float8 AS quantity, unit::text AS unit,
            min_order_quantity::float8 AS min_order
       FROM public.produce_listing WHERE id = ANY($1::uuid[])`,
    ids,
  );
  const open = await db.$queryRawUnsafe<{ listing_id: string }[]>(
    `SELECT DISTINCT listing_id FROM public.purchase_request
      WHERE organization_id = $1::uuid AND listing_id = ANY($2::uuid[])
        AND status IN ('submitted', 'under_review') AND deleted_at IS NULL`,
    organizationId,
    ids,
  );
  const byId = new Map(listings.map((l) => [l.id, l]));
  const waiting = new Set(open.map((o) => o.listing_id));
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const at = field(index);
    if (seen.has(item.listing_id)) {
      reasons[at] = BUYER_MESSAGES.productTwiceInCart;
      return;
    }
    seen.add(item.listing_id);
    if (waiting.has(item.listing_id)) {
      reasons[at] = BUYER_MESSAGES.requestAlreadyOpen;
      return;
    }
    const listing = byId.get(item.listing_id);
    if (!listing || item.unit !== listing.unit) return;
    if (item.quantity > listing.quantity) reasons[at] = BUYER_MESSAGES.quantityAboveAvailable;
    else if (listing.min_order !== null && item.quantity < listing.min_order) {
      reasons[at] = BUYER_MESSAGES.quantityBelowMinimum;
    }
  });
  if (Object.keys(reasons).length > 0) {
    throw new ApiFailure(
      422,
      ERROR_CODES.unprocessable,
      RULE_MESSAGES.request_items_refused,
      reasons,
    );
  }
}

/** The fixed sentence a farmer is sent when a buyer cancels a request (2026-10-08). */
export { FARMER_CANCEL_NOTICE };

/**
 * Tells the farmer behind a listing that a buyer cancelled a request they had
 * sent. Before this the request only changed quietly on the dashboard, so a
 * farmer could still call a buyer who had withdrawn. Inside the caller's
 * audited transaction, recorded as the buyer's act.
 */
export async function notifyFarmerOfCancel(
  tx: AuditTx,
  listingId: string,
  actor: { actorType: 'buyer'; actorId: string },
): Promise<void> {
  const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO public.notification (farmer_id, channel, title, body)
     SELECT pl.farmer_id, 'in_app', $2, $3 FROM public.produce_listing pl WHERE pl.id = $1::uuid
     RETURNING id`,
    listingId,
    FARMER_CANCEL_NOTICE.title,
    FARMER_CANCEL_NOTICE.body,
  );
  if (!row) return;
  await writeAudit(tx, {
    entityType: 'notification',
    entityId: row.id,
    ...actor,
    action: 'notification.created',
    after: { recipient: 'farmer', notice: 'request_cancelled' },
  });
}

/**
 * The farmer's contact phone for a listing, IF the caller's organisation has
 * sent a request for it (the owner's rule, 2026-10-07: the number is revealed
 * after the buyer asks). A draft or a cancelled request reveals nothing.
 */
export async function contactPhoneIfRequested(
  db: Db,
  organizationId: string,
  listingId: string,
): Promise<string | null> {
  const [row] = await db.$queryRawUnsafe<{ contact_phone: string }[]>(
    `SELECT pl.contact_phone FROM public.produce_listing pl
      WHERE pl.id = $1::uuid AND EXISTS (
        SELECT 1 FROM public.purchase_request r
         WHERE r.listing_id = pl.id AND r.organization_id = $2::uuid AND r.deleted_at IS NULL
           AND r.status NOT IN ('draft', 'cancelled'))`,
    listingId,
    organizationId,
  );
  return row?.contact_phone ?? null;
}
