import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import {
  BUYING_REQUEST_FROM,
  OWN_BUYING_REQUEST_COLUMNS,
  actingPoster,
  ownerParam,
  ownerWhere,
  presentOwnBuyingRequest,
  type BuyingRequestRow,
} from '../../../../lib/api/market-posts';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/buying-requests/mine -- the signed-in account's own buying
 * requests, every status, newest change first. LISTINGS LANE (2026-10-19).
 * A poster's own list is short, so it is returned whole (at most 200), as the
 * farmer's own listings are.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, request }) => {
      // 2026-10-27: the person's own, or the organisation's they act for.
      const poster = await actingPoster(prisma, request, auth);
      const rows = await prisma.$queryRawUnsafe<(BuyingRequestRow & { contact_phone: string })[]>(
        `SELECT ${OWN_BUYING_REQUEST_COLUMNS} ${BUYING_REQUEST_FROM}
          WHERE ${ownerWhere(poster, 'br', '$1')}
          ORDER BY br.updated_at DESC, br.id DESC LIMIT 200`,
        ownerParam(poster),
      );
      return ok(rows.map(presentOwnBuyingRequest));
    },
  },
});
