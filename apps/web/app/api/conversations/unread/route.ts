import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import { viewerOf, viewerWhere } from '../../../../lib/api/messaging';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/conversations/unread -- how many of the caller's conversations have
 * a message they have not seen. The number on the Messages badge; nothing
 * else, so the menu can ask it cheaply on every page.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, request }) => {
      // 2026-10-27: the viewer's inbox -- personal, or the organisation acted for.
      const viewer = await viewerOf(prisma, request, auth, 'inbox.read');
      const [row] = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n
           FROM (SELECT c.*,
                   CASE WHEN $2::uuid IS NOT NULL
                        THEN CASE WHEN c.owner_organization_id = $2::uuid
                                  THEN 'owner' ELSE 'starter' END
                        ELSE CASE WHEN c.owner_organization_id IS NULL
                                   AND c.owner_auth_user_id = $1::uuid
                                  THEN 'owner' ELSE 'starter' END
                   END AS my_side,
                   COALESCE(c.last_sender_side,
                     CASE WHEN c.last_sender_auth_user_id = c.owner_auth_user_id
                          THEN 'owner' ELSE 'starter' END) AS last_side
                   FROM public.conversation c
                  WHERE ${viewerWhere('$1', '$2')}) c
          WHERE c.last_sender_auth_user_id IS NOT NULL
            AND c.last_side <> c.my_side
            AND COALESCE(CASE WHEN c.my_side = 'owner'
                              THEN c.owner_read_at ELSE c.starter_read_at END,
                         '-infinity'::timestamptz) < c.last_message_at`,
        viewer.person,
        viewer.org,
      );
      return ok({ unread: row?.n ?? 0 });
    },
  },
});
