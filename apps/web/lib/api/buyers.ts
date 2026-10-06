import { buyerCapabilities, type BuyerVerificationStatus } from '@agri-erp/shared';

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
import { forbidden, notFound, unprocessable } from './errors';
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
  actor: { actorType: 'admin' | 'supervisor' | 'buyer'; actorId: string },
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
