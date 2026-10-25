import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import {
  OWN_SERVICE_COLUMNS,
  SERVICE_FROM,
  SERVICE_WHERE,
  actingPoster,
  ownerParam,
  ownerWhere,
  presentOwnService,
  type ServiceRow,
} from '../../../../lib/api/market-posts';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/services/mine -- the signed-in account's own service listings,
 * every status, newest change first (at most 200). LISTINGS LANE (2026-10-19);
 * 2026-10-26: a farmer's or a buyer account's, by the session (marketPoster).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, request }) => {
      // 2026-10-27: the person's own, or the organisation's they act for.
      const poster = await actingPoster(prisma, request, auth);
      const rows = await prisma.$queryRawUnsafe<(ServiceRow & { contact_phone: string })[]>(
        `SELECT ${OWN_SERVICE_COLUMNS} ${SERVICE_FROM}
          WHERE ${ownerWhere(poster, 'sl', '$1')} AND ${SERVICE_WHERE}
          ORDER BY sl.updated_at DESC, sl.id DESC LIMIT 200`,
        ownerParam(poster),
      );
      return ok(rows.map(presentOwnService));
    },
  },
});
