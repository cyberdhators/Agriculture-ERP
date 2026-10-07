import { FARMER_ROLE } from '@agri-erp/shared';

import { defineRoutes, paged } from '../../../../lib/api/route';
import { farmerScope } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/farmer/notifications -- the farmer's own in-app notices, newest
 * first, with the unread count beside them. B14. The existing notification
 * table, filtered to the session's farmer; the most recent 100.
 */
interface Row {
  id: string;
  title: string;
  body: string;
  read_at: Date | null;
  created_at: Date;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE],
    handler: async ({ auth }) => {
      const { farmerId } = farmerScope(auth);
      const rows = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT id, title, body, read_at, created_at FROM public.notification
          WHERE farmer_id = $1::uuid AND deleted_at IS NULL
          ORDER BY created_at DESC, id DESC LIMIT 100`,
        farmerId,
      );
      return paged(
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          body: r.body,
          read_at: r.read_at?.toISOString() ?? null,
          created_at: r.created_at.toISOString(),
        })),
        { cursor: null, hasMore: false, unread: rows.filter((r) => !r.read_at).length },
      );
    },
  },
});
