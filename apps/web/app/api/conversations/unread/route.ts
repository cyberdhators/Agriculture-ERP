import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import { me } from '../../../../lib/api/messaging';
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
    handler: async ({ auth }) => {
      const reader = me(auth);
      const [row] = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM public.conversation c
          WHERE $1::uuid IN (c.owner_auth_user_id, c.starter_auth_user_id)
            AND c.last_sender_auth_user_id IS NOT NULL
            AND c.last_sender_auth_user_id <> $1::uuid
            AND COALESCE(CASE WHEN c.owner_auth_user_id = $1::uuid
                              THEN c.owner_read_at ELSE c.starter_read_at END,
                         '-infinity'::timestamptz) < c.last_message_at`,
        reader,
      );
      return ok({ unread: row?.n ?? 0 });
    },
  },
});
