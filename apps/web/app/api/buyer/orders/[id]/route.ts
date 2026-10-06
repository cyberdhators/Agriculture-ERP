import {
  BUYER_ROLE,
  buyerCancelOrderSchema,
  buyerMayCancelOrder,
  type PurchaseOrderStatus,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import {
  buyerActor,
  deliveryUpdatesFor,
  loadOwnOrder,
  presentOrder,
} from '../../../../../lib/api/buyers';
import { unprocessable } from '../../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { buyerScope } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/**
 * GET and PATCH /api/buyer/orders/:id. B13, C-14B.12, C-14B.13, C-14B.22.
 *
 * `/api/buyer/orders/123` answers only if order 123 belongs to the caller's
 * organisation; otherwise it is the same 404 as an order that never existed.
 *
 * The PATCH is the one write a buyer has on an order: cancelling it while it
 * is still pending, with a reason. Everything after confirmation is CORWADO's
 * to record, because by then a farmer has been asked to set produce aside.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [BUYER_ROLE],
    handler: async ({ auth, params }) => {
      const scope = buyerScope(auth);
      const order = await loadOwnOrder(prisma, scope.organizationId, params.id ?? '');
      const timeline = await deliveryUpdatesFor(prisma, [order.id]);
      return ok({ ...presentOrder(order), timeline: timeline.get(order.id) ?? [] });
    },
  },

  PATCH: {
    roles: [BUYER_ROLE],
    bodySchema: buyerCancelOrderSchema,
    handler: async ({ auth, body, params }) => {
      const scope = buyerScope(auth);
      const id = params.id ?? '';
      await audited(prisma, async (tx) => {
        const order = await loadOwnOrder(tx, scope.organizationId, id, true);
        if (!buyerMayCancelOrder(order.status as PurchaseOrderStatus)) {
          throw unprocessable('order_not_cancellable');
        }
        await tx.$executeRawUnsafe(
          `UPDATE public.purchase_order
              SET status = 'cancelled', cancel_reason = $2, updated_at = now()
            WHERE id = $1::uuid`,
          id,
          body.reason,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO public.delivery_update (order_id, status, note, recorded_by_buyer)
           VALUES ($1::uuid, 'cancelled', $2, $3::uuid)`,
          id,
          body.reason,
          scope.buyerId,
        );
        await writeAudit(tx, {
          entityType: 'purchase_order',
          entityId: id,
          ...buyerActor(auth),
          action: 'purchase_order.cancelled',
          before: { status: order.status },
          // The reason is the buyer's free text; it stays on the order, not in the log.
          after: { status: 'cancelled' },
        });
      });
      const order = await loadOwnOrder(prisma, scope.organizationId, id);
      const timeline = await deliveryUpdatesFor(prisma, [order.id]);
      return ok({ ...presentOrder(order), timeline: timeline.get(order.id) ?? [] });
    },
  },
});
