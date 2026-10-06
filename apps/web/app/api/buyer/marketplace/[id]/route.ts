import { BUYER_ROLE } from '@agri-erp/shared';

import {
  MARKET_BASE_WHERE,
  MARKET_COLUMNS,
  MARKET_FROM,
  UUID_PATTERN,
  presentMarketListing,
  requireBrowse,
  type MarketRow,
} from '../../../../../lib/api/buyers';
import { notFound } from '../../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/buyer/marketplace/:id -- one product, as a buyer may see it.
 * B13, C-14B.10.
 *
 * A listing that is withdrawn, sold, a draft, removed, or whose seller was
 * removed is 404, exactly as one that never existed. The same whitelist as
 * the list: the detail page shows more of the listing, never more of the
 * farmer.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [BUYER_ROLE],
    handler: async ({ auth, params }) => {
      requireBrowse(auth);
      const id = params.id ?? '';
      if (!UUID_PATTERN.test(id)) throw notFound();
      const [row] = await prisma.$queryRawUnsafe<MarketRow[]>(
        `SELECT ${MARKET_COLUMNS} ${MARKET_FROM}
          WHERE ${MARKET_BASE_WHERE} AND pl.id = $1::uuid`,
        id,
      );
      if (!row) throw notFound();
      return ok(presentMarketListing(row));
    },
  },
});
