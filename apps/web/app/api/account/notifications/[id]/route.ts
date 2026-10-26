import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import { UUID_PATTERN } from '../../../../../lib/api/buyer-presenters';
import { notFound } from '../../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/account/notifications/:id (2026-10-26) -- ONE of the signed-in
 * account's own notices, for the live pop: a live event carries only the
 * notice's id (lib/realtime), and the screen reads the text here, through a
 * session, exactly as the notifications page does.
 *
 * Own notices only: those stored on the account's farmer record, or on the
 * organisation its buyer account buys for. Anything else -- another
 * account's notice, a removed one, a malformed id -- is 404, so a notice's
 * existence is never told. Reading here does not mark it read.
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
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params }) => {
      const id = params.id ?? '';
      if (!UUID_PATTERN.test(id)) throw notFound();
      const [row] = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT n.id, n.title, n.body, n.read_at, n.created_at
           FROM public.notification n
          WHERE n.id = $1::uuid AND n.deleted_at IS NULL
            AND (n.farmer_id IN (SELECT f.id FROM public.farmer f
                                  WHERE f.auth_user_id = $2::uuid AND f.deleted_at IS NULL)
              OR n.buyer_organization_id IN (SELECT b.organization_id FROM public.buyer b
                                  WHERE b.auth_user_id = $2::uuid AND b.deleted_at IS NULL))`,
        id,
        auth.principal.authUserId,
      );
      if (!row) throw notFound();
      return ok(
        {
          id: row.id,
          title: row.title,
          body: row.body,
          read_at: row.read_at?.toISOString() ?? null,
          created_at: row.created_at.toISOString(),
        },
        { 'cache-control': 'no-store' },
      );
    },
  },
});
