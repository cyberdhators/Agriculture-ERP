import { decodeCursor, encodeCursor, productReportFilterSchema, toIso } from '@agri-erp/shared';

import { invalidCursor } from '../../../../lib/api/errors';
import {
  MARKET_REPORT_SELECT,
  pageLimit,
  parseQuery,
  type MarketReportRow,
} from '../../../../lib/api/market-posts';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/admin/market-reports -- reports about buying requests and service
 * listings. ADMINISTRATOR ONLY, like the product-report queue it sits beside.
 * LISTINGS LANE (2026-10-19).
 *
 * The same filters as /api/admin/product-reports (status, reason), newest
 * first. THE REPORTER IS NEVER RETURNED, and neither is the description in a
 * list -- it is free text a stranger wrote; the one-report route returns it.
 */

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ request }) => {
      const filter = parseQuery(request, productReportFilterSchema);
      const limit = pageLimit(filter.limit);
      const params: unknown[] = [];
      const where: string[] = [];
      if (filter.status) {
        params.push(filter.status);
        where.push(`r.status = $${params.length}::public.report_status`);
      }
      if (filter.reason) {
        params.push(filter.reason);
        where.push(`r.reason = $${params.length}::public.report_reason`);
      }
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(r.created_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }
      const rows = await prisma.$queryRawUnsafe<MarketReportRow[]>(
        `${MARKET_REPORT_SELECT}
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(
        page.map((row) => ({
          id: row.id,
          target_type: row.target_type,
          target_id: row.target_id,
          // Absent once the post was removed: the report outlives its subject.
          ...(row.target_title === null ? {} : { target_title: row.target_title }),
          ...(row.poster_name === null ? {} : { poster_name: row.poster_name }),
          ...(row.target_status === null ? {} : { target_status: row.target_status }),
          reason: row.reason,
          status: row.status,
          created_at: toIso(row.created_at),
          updated_at: toIso(row.updated_at),
        })),
        {
          cursor:
            hasMore && last
              ? encodeCursor({ createdAt: toIso(last.created_at), id: last.id })
              : null,
          hasMore,
        },
      );
    },
  },
});
