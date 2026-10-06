import {
  BUYER_MESSAGES,
  BUYER_ROLE,
  DEFAULT_LIMIT,
  ERROR_CODES,
  ERROR_MESSAGES,
  MAX_LIMIT,
  PURCHASE_ORDER_STATUSES,
  buyerListFilterSchema,
  decodeCursor,
  encodeCursor,
  zodErrorToApiError,
} from '@agri-erp/shared';

import { ORDER_COLUMNS, ORDER_FROM, presentOrder, type OrderRow } from '../../../../lib/api/buyers';
import { ApiFailure, invalidCursor } from '../../../../lib/api/errors';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { buyerScope } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/buyer/orders -- the organisation's orders, newest first. B13,
 * C-14B.12.
 *
 * Orders are arranged by CORWADO staff against a listing; a buyer reads them
 * here whatever their standing, because an order already arranged is history
 * the organisation is entitled to see. The farmer behind each is never named:
 * the supplier is the listing's trading name, county and state.
 *
 * No payment fields exist. The total is computed by the database from the
 * quantity and the unit price, and is the amount agreed, not an amount paid.
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

      const params: unknown[] = [scope.organizationId];
      const where = ['o.organization_id = $1::uuid', 'o.deleted_at IS NULL'];
      if (filter.status) {
        if (!(PURCHASE_ORDER_STATUSES as readonly string[]).includes(filter.status)) {
          throw new ApiFailure(400, ERROR_CODES.invalidInput, ERROR_MESSAGES.invalidInput, {
            status: BUYER_MESSAGES.statusFilterUnknown,
          });
        }
        params.push(filter.status);
        where.push(`o.status = $${params.length}::public.purchase_order_status`);
      }
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(o.created_at, o.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<OrderRow[]>(
        `SELECT ${ORDER_COLUMNS} ${ORDER_FROM}
          WHERE ${where.join(' AND ')}
          ORDER BY o.created_at DESC, o.id DESC
          LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(page.map(presentOrder), {
        cursor:
          hasMore && last
            ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
            : null,
        hasMore,
      });
    },
  },
});
