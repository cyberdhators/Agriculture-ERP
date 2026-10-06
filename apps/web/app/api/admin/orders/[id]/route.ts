import { canMoveOrder, orderStatusSchema, type PurchaseOrderStatus } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import {
  ORDER_COLUMNS,
  ORDER_FROM,
  UUID_PATTERN,
  deliveryUpdatesFor,
  notifyOrganization,
  presentOrder,
  type OrderRow,
} from '../../../../../lib/api/buyers';
import { notFound, unprocessable } from '../../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * PATCH /api/admin/orders/:id -- record an order's progress. Administrator
 * only. B13, C-14B.12 and C-14B.13.
 *
 * Forward only, by the transition table; every move appends one
 * delivery_update, so the buyer's timeline is the record of what CORWADO said
 * and when, and the order's own status is always its latest entry.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: ['admin'],
    bodySchema: orderStatusSchema,
    handler: async ({ auth, body, params }) => {
      const id = params.id ?? '';
      if (!UUID_PATTERN.test(id)) throw notFound();
      const actor = { actorType: 'admin' as const, actorId: auth.principal.id };

      await audited(prisma, async (tx) => {
        const [current] = await tx.$queryRawUnsafe<{ status: string; organization_id: string }[]>(
          `SELECT status::text AS status, organization_id FROM public.purchase_order
            WHERE id = $1::uuid AND deleted_at IS NULL FOR UPDATE`,
          id,
        );
        if (!current) throw notFound();
        const from = current.status as PurchaseOrderStatus;
        if (!canMoveOrder(from, body.status)) throw unprocessable('transition_not_allowed');

        await tx.$executeRawUnsafe(
          `UPDATE public.purchase_order
              SET status = $2::public.purchase_order_status,
                  cancel_reason = CASE WHEN $4::boolean THEN $3 ELSE cancel_reason END,
                  updated_at = now()
            WHERE id = $1::uuid`,
          id,
          body.status,
          body.note ?? null,
          body.status === 'cancelled',
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO public.delivery_update (order_id, status, note, recorded_by_user)
           VALUES ($1::uuid, $2::public.purchase_order_status, $3, $4::uuid)`,
          id,
          body.status,
          body.note ?? null,
          auth.principal.id,
        );
        await writeAudit(tx, {
          entityType: 'purchase_order',
          entityId: id,
          ...actor,
          action:
            body.status === 'cancelled'
              ? 'purchase_order.cancelled'
              : 'purchase_order.status_changed',
          before: { status: from },
          after: { status: body.status },
        });
        await notifyOrganization(tx, current.organization_id, 'order_status_changed', actor);
      });

      const [order] = await prisma.$queryRawUnsafe<OrderRow[]>(
        `SELECT ${ORDER_COLUMNS} ${ORDER_FROM} WHERE o.id = $1::uuid`,
        id,
      );
      const timeline = await deliveryUpdatesFor(prisma, [id]);
      return ok({ ...presentOrder(order!), timeline: timeline.get(id) ?? [] });
    },
  },
});
