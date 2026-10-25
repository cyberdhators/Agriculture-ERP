import { adviserQueueFilterSchema, decodeCursor, encodeCursor } from '@agri-erp/shared';

import {
  STAFF_APPLICATION_SELECT,
  presentStaffApplication,
  type StaffApplicationRow,
} from '../../../../lib/api/adviser-approval';
import { invalidCursor } from '../../../../lib/api/errors';
import { pageLimit, parseQuery } from '../../../../lib/api/market-posts';
import { requirePermission } from '../../../../lib/api/permissions';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/admin/advisers?status= -- the approved-adviser queue (2026-10-24).
 * ADMINISTRATOR ONLY, and then `content.moderate` ("Moderate content and
 * listings"), the permission that already decides account suspension:
 * reviewing what a user submitted and taking a standing away again is
 * moderation, not CORWADO publishing its own content (`content.publish`).
 *
 * One status per page (default `submitted`). The two open statuses read
 * oldest first, so the longest-waiting application is at the top; the
 * decided ones newest first. No phone and no sign-in id leave here.
 */
const OPEN = new Set(['submitted', 'clarification_requested']);

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth, request }) => {
      await requirePermission(auth, 'content.moderate');
      const filter = parseQuery(request, adviserQueueFilterSchema);
      const limit = pageLimit(filter.limit);
      const oldestFirst = OPEN.has(filter.status);

      const params: unknown[] = [filter.status];
      // 2026-10-28: a suspension past its end is an approval again (it
      // lapsed by itself), so it is listed under Approved, not Suspended.
      const where = [
        'a.deleted_at IS NULL',
        filter.status === 'approved'
          ? `(a.status = $1 OR (a.status = 'suspended' AND a.suspended_until <= now()))`
          : filter.status === 'suspended'
            ? `(a.status = $1 AND a.suspended_until > now())`
            : 'a.status = $1',
      ];
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(`(a.updated_at, a.id) ${oldestFirst ? '>' : '<'} ($2::timestamptz, $3::uuid)`);
      }
      const order = oldestFirst ? 'ASC' : 'DESC';
      const rows = await prisma.$queryRawUnsafe<StaffApplicationRow[]>(
        `${STAFF_APPLICATION_SELECT}
          WHERE ${where.join(' AND ')}
          ORDER BY a.updated_at ${order}, a.id ${order}
          LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(page.map(presentStaffApplication), {
        cursor:
          hasMore && last
            ? encodeCursor({ createdAt: last.updated_at.toISOString(), id: last.id })
            : null,
        hasMore,
      });
    },
  },
});
