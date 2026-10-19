import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import { notFound } from '../../../../../lib/api/errors';
import {
  BUYING_REQUEST_FROM,
  BUYING_REQUEST_MARKET_WHERE,
  checkId,
  marketPoster,
} from '../../../../../lib/api/market-posts';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/buying-requests/:id/contact -- the poster's phone, for a signed-in
 * farmer or buyer who can supply what they asked for. LISTINGS LANE
 * (2026-10-19). Never public: a phone on an open page is a phone harvested.
 * Only for a request on the market; anything else is 404.
 *
 * 2026-10-20: the number only if the poster chose to show it; otherwise
 * contact_phone is null and the screen offers in-app messaging instead.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params }) => {
      marketPoster(auth);
      const [row] = await prisma.$queryRawUnsafe<
        { display_name: string; contact_phone: string; show_phone: boolean }[]
      >(
        `SELECT br.display_name, br.contact_phone, br.show_phone ${BUYING_REQUEST_FROM}
          WHERE br.id = $1::uuid AND ${BUYING_REQUEST_MARKET_WHERE}`,
        checkId(params.id),
      );
      if (!row) throw notFound();
      return ok({
        display_name: row.display_name,
        contact_phone: row.show_phone ? row.contact_phone : null,
      });
    },
  },
});
