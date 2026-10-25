import { adminMarketplaceQuerySchema, decodeCursor, encodeCursor, toIso } from '@agri-erp/shared';

import {
  buildMarketplaceQuery,
  presentMarketplaceRow,
  type MarketplaceRow,
} from '../../../../lib/api/admin-marketplace';
import { invalidCursor } from '../../../../lib/api/errors';
import { pageLimit, parseQuery } from '../../../../lib/api/market-posts';
import { requirePermission } from '../../../../lib/api/permissions';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/admin/marketplace -- the staff marketplace console (2026-10-28,
 * CORWADO's specification, Marketplace: "Produce, inputs, buying requests,
 * services and inactive listings"). ADMINISTRATOR ONLY, and then
 * `content.moderate`, as every moderation route.
 *
 * `tab` is produce | inputs | buying_requests | services (live posts) or
 * inactive (paused, expired, withdrawn, completed; narrowed by `status` and
 * `kind`). Filters: q (title, product, poster or organisation name), state_id,
 * category (or service type), flag (reported | correction). Newest first.
 *
 * Drafts are never listed, nor anything soft-deleted: removed posts are read
 * from the audit trail by GET /api/admin/marketplace/removed. A suspended
 * account's posts ARE listed, flagged, because this is a staff read and not
 * the market (lib/api/admin-marketplace.ts). No phone number is returned.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth, request }) => {
      await requirePermission(auth, 'content.moderate');
      const filter = parseQuery(request, adminMarketplaceQuerySchema);
      const limit = pageLimit(filter.limit);
      const built = buildMarketplaceQuery(filter);
      const params = [...built.params];
      const where = [...built.where];
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(p.created_at, p.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }
      const rows = await prisma.$queryRawUnsafe<MarketplaceRow[]>(
        `SELECT p.* FROM ${built.from}
          WHERE ${where.join(' AND ')}
          ORDER BY p.created_at DESC, p.id DESC
          LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(page.map(presentMarketplaceRow), {
        cursor:
          hasMore && last ? encodeCursor({ createdAt: toIso(last.created_at), id: last.id }) : null,
        hasMore,
      });
    },
  },
});
