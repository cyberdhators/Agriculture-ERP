import {
  BUYER_ROLE,
  DEFAULT_LIMIT,
  DELIVERY_STAGE_STATUSES,
  MAX_LIMIT,
  buyerListFilterSchema,
  decodeCursor,
  encodeCursor,
  zodErrorToApiError,
} from '@agri-erp/shared';

import {
  ORDER_COLUMNS,
  ORDER_FROM,
  deliveryUpdatesFor,
  presentOrder,
  type OrderRow,
} from '../../../../lib/api/buyers';
import { ApiFailure, invalidCursor } from '../../../../lib/api/errors';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { buyerScope } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/buyer/deliveries -- orders whose goods are moving or have arrived,
 * each with its timeline. B13, C-14B.13.
 *
 * NOT A TRACKING SYSTEM. There is no GPS, no vehicle, no live position, and
 * this route invents none: the "current status" is the order's status, and
 * the timeline is what CORWADO staff recorded and when. `delivery_update` is
 * where a position would be added if tracking is ever built.
 *
 * Sorted by the order's last change, so the delivery that moved most recently
 * is first.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [BUYER_ROLE],
    handler: async ({ request, auth }) => {
      const scope = buyerScope(auth);
      const parsed = buyerListFilterSchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success) {
        const { body } = zodErrorToApiError(parsed.error);
        throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
      }
      const filter = parsed.data;
      let limit = DEFAULT_LIMIT;
      if (filter.limit !== undefined) {
        const n = Number(filter.limit);
        if (!Number.isInteger(n) || n < 1) throw invalidCursor();
        limit = Math.min(n, MAX_LIMIT);
      }

      const params: unknown[] = [scope.organizationId, [...DELIVERY_STAGE_STATUSES]];
      const where = [
        'o.organization_id = $1::uuid',
        'o.deleted_at IS NULL',
        'o.status = ANY($2::public.purchase_order_status[])',
      ];
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(o.updated_at, o.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<OrderRow[]>(
        `SELECT ${ORDER_COLUMNS} ${ORDER_FROM}
          WHERE ${where.join(' AND ')}
          ORDER BY o.updated_at DESC, o.id DESC
          LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const timelines = await deliveryUpdatesFor(
        prisma,
        page.map((r) => r.id),
      );
      const last = page[page.length - 1];
      return paged(
        page.map((row) => {
          const timeline = timelines.get(row.id) ?? [];
          return {
            ...presentOrder(row),
            // The most recent note CORWADO recorded, if any: what "delivery
            // notes" means here. Never composed; it is what was written.
            latest_note: timeline.find((t) => t.note !== null)?.note ?? null,
            timeline,
          };
        }),
        {
          cursor:
            hasMore && last
              ? encodeCursor({ createdAt: last.updated_at.toISOString(), id: last.id })
              : null,
          hasMore,
        },
      );
    },
  },
});
