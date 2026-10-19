import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import {
  BUYING_REQUEST_FROM,
  OWN_BUYING_REQUEST_COLUMNS,
  marketPoster,
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
    handler: async ({ auth }) => {
      const poster = marketPoster(auth);
      const rows = await prisma.$queryRawUnsafe<(BuyingRequestRow & { contact_phone: string })[]>(
        `SELECT ${OWN_BUYING_REQUEST_COLUMNS} ${BUYING_REQUEST_FROM}
          WHERE br.${poster.column} = $1::uuid
          ORDER BY br.updated_at DESC, br.id DESC LIMIT 200`,
        poster.id,
      );
      return ok(rows.map(presentOwnBuyingRequest));
    },
  },
});
