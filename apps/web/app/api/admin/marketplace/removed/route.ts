import { decodeCursor, encodeCursor, toIso } from '@agri-erp/shared';

import {
  REMOVAL_ACTIONS,
  REMOVED_SQL,
  presentRemovedRow,
  type RemovedRow,
} from '../../../../../lib/api/admin-marketplace';
import { invalidCursor } from '../../../../../lib/api/errors';
import { pageLimit } from '../../../../../lib/api/market-posts';
import { requirePermission } from '../../../../../lib/api/permissions';
import { defineRoutes, paged } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/admin/marketplace/removed -- posts staff removed, newest first
 * (2026-10-28). ADMINISTRATOR ONLY, then `content.moderate`.
 *
 * READ FROM THE AUDIT TRAIL, NOT FROM THE REMOVED POSTS. A removal is a soft
 * delete, and the deletion law keeps soft-deleted rows out of every list; the
 * audit trail's record of the removal (who, when, the reason and, from this
 * console, the title) is what staff see. Query: limit, cursor.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth, request }) => {
      await requirePermission(auth, 'content.moderate');
      const search = new URL(request.url).searchParams;
      const limit = pageLimit(search.get('limit') ?? undefined);
      const params: unknown[] = [[...REMOVAL_ACTIONS]];
      let cursorSql = '';
      const rawCursor = search.get('cursor');
      if (rawCursor !== null) {
        const cursor = decodeCursor(rawCursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        cursorSql = `AND (ae.occurred_at, ae.id) < ($2::timestamptz, $3::uuid)`;
      }
      const rows = await prisma.$queryRawUnsafe<RemovedRow[]>(
        `${REMOVED_SQL} ${cursorSql}
          ORDER BY ae.occurred_at DESC, ae.id DESC
          LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(page.map(presentRemovedRow), {
        cursor:
          hasMore && last
            ? encodeCursor({ createdAt: toIso(last.removed_at), id: last.audit_id })
            : null,
        hasMore,
      });
    },
  },
});
