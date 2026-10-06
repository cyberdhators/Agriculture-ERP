import {
  BUYER_MESSAGES,
  DEFAULT_LIMIT,
  ERROR_CODES,
  ERROR_MESSAGES,
  MAX_LIMIT,
  PURCHASE_REQUEST_STATUSES,
  buyerListFilterSchema,
  decodeCursor,
  encodeCursor,
  zodErrorToApiError,
} from '@agri-erp/shared';

import {
  REQUEST_COLUMNS,
  REQUEST_FROM,
  presentRequest,
  type RequestRow,
} from '../../../../lib/api/buyers';
import { ApiFailure, invalidCursor } from '../../../../lib/api/errors';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/admin/purchase-requests -- every organisation's SUBMITTED requests,
 * oldest first. Administrator only. B13, C-14B.11.
 *
 * Drafts are excluded: a draft is a buyer's working note and has not been
 * sent to anybody.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ request }) => {
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
      const params: unknown[] = [];
      const where = ["r.status <> 'draft'", 'r.deleted_at IS NULL'];
      if (filter.status) {
        if (
          filter.status === 'draft' ||
          !(PURCHASE_REQUEST_STATUSES as readonly string[]).includes(filter.status)
        ) {
          throw new ApiFailure(400, ERROR_CODES.invalidInput, ERROR_MESSAGES.invalidInput, {
            status: BUYER_MESSAGES.statusFilterUnknown,
          });
        }
        params.push(filter.status);
        where.push(`r.status = $${params.length}::public.purchase_request_status`);
      }
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(r.created_at, r.id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }
      const rows = await prisma.$queryRawUnsafe<
        (RequestRow & { organization_id: string; organization_name: string })[]
      >(
        `SELECT ${REQUEST_COLUMNS}, r.organization_id, org.name AS organization_name
           ${REQUEST_FROM}
           JOIN public.buyer_organization org ON org.id = r.organization_id
          WHERE ${where.join(' AND ')}
          ORDER BY r.created_at ASC, r.id ASC
          LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(
        page.map((r) => ({
          ...presentRequest(r),
          organization: { id: r.organization_id, name: r.organization_name },
        })),
        {
          cursor:
            hasMore && last
              ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
              : null,
          hasMore,
        },
      );
    },
  },
});
