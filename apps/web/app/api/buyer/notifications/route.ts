import { BUYER_ROLE, DEFAULT_LIMIT, MAX_LIMIT, decodeCursor, encodeCursor } from '@agri-erp/shared';

import { invalidCursor } from '../../../../lib/api/errors';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { buyerScope } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/buyer/notifications -- the organisation's in-app notices, newest
 * first, with the unread count beside the page. B13, C-14B.20.
 *
 * The existing notification table, filtered to the session's organisation.
 * A farmer's notification has no organisation and can never match; the
 * staff route joins farmer and so never sees a buyer's.
 */
interface NotificationRow {
  id: string;
  title: string;
  body: string;
  read_at: Date | null;
  created_at: Date;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [BUYER_ROLE],
    handler: async ({ request, auth }) => {
      const scope = buyerScope(auth);
      const url = new URL(request.url);
      let limit = DEFAULT_LIMIT;
      const rawLimit = url.searchParams.get('limit');
      if (rawLimit !== null) {
        const n = Number(rawLimit);
        if (!Number.isInteger(n) || n < 1) throw invalidCursor();
        limit = Math.min(n, MAX_LIMIT);
      }

      const params: unknown[] = [scope.organizationId];
      const where = ['buyer_organization_id = $1::uuid', 'deleted_at IS NULL'];
      if (url.searchParams.get('unread') === '1') where.push('read_at IS NULL');
      const rawCursor = url.searchParams.get('cursor');
      if (rawCursor !== null) {
        const cursor = decodeCursor(rawCursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      const [rows, [unread]] = await Promise.all([
        prisma.$queryRawUnsafe<NotificationRow[]>(
          `SELECT id, title, body, read_at, created_at FROM public.notification
            WHERE ${where.join(' AND ')}
            ORDER BY created_at DESC, id DESC
            LIMIT ${limit + 1}`,
          ...params,
        ),
        prisma.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM public.notification
            WHERE buyer_organization_id = $1::uuid AND deleted_at IS NULL AND read_at IS NULL`,
          scope.organizationId,
        ),
      ]);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(
        page.map((row) => ({
          id: row.id,
          title: row.title,
          body: row.body,
          read_at: row.read_at?.toISOString() ?? null,
          created_at: row.created_at.toISOString(),
        })),
        {
          cursor:
            hasMore && last
              ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
              : null,
          hasMore,
          unread: unread?.n ?? 0,
        },
      );
    },
  },
});
