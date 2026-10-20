import { notFound } from '../../../../lib/api/errors';
import {
  PUBLIC_GUIDE_COLUMNS,
  PUBLIC_GUIDE_FROM,
  PUBLIC_GUIDE_WHERE,
  presentGuide,
  type PublicGuideRow,
} from '../../../../lib/api/learning';
import { checkId } from '../../../../lib/api/market-posts';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/guides/:id -- one published guide, for anyone (2026-10-22). The
 * same whitelist as the list (presentGuide). A guide that is not published --
 * a draft, in review, unpublished, removed -- is the house 404, the same
 * answer as one that never existed.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async ({ params }) => {
      const [row] = await prisma.$queryRawUnsafe<PublicGuideRow[]>(
        `SELECT ${PUBLIC_GUIDE_COLUMNS} ${PUBLIC_GUIDE_FROM}
          WHERE id = $1::uuid AND ${PUBLIC_GUIDE_WHERE}`,
        checkId(params.id),
      );
      if (!row) throw notFound();
      return ok(presentGuide(row));
    },
  },
});
