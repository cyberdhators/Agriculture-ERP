import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import { notFound } from '../../../../../lib/api/errors';
import {
  SERVICE_FROM,
  SERVICE_MARKET_WHERE,
  checkId,
  marketPoster,
} from '../../../../../lib/api/market-posts';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/services/:id/contact -- the provider's phone, for a signed-in
 * farmer or buyer who wants to hire the service. LISTINGS LANE (2026-10-19).
 * Never public. Only for a service on the market; anything else is 404.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params }) => {
      marketPoster(auth);
      const [row] = await prisma.$queryRawUnsafe<{ trading_name: string; contact_phone: string }[]>(
        `SELECT sl.trading_name, sl.contact_phone ${SERVICE_FROM}
          WHERE sl.id = $1::uuid AND ${SERVICE_MARKET_WHERE}`,
        checkId(params.id),
      );
      if (!row) throw notFound();
      return ok({ display_name: row.trading_name, contact_phone: row.contact_phone });
    },
  },
});
