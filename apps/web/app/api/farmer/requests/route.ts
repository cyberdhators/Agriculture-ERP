import { FARMER_ROLE } from '@agri-erp/shared';

import {
  INCOMING_COLUMNS,
  INCOMING_FROM,
  INCOMING_WHERE,
  presentIncoming,
  type IncomingRow,
} from '../../../../lib/api/farmer-accounts';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { farmerScope } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/farmer/requests -- requests buyers sent for the farmer's produce,
 * for the farmer's dashboard. B14.
 *
 * Buyers and farmers deal directly, with no third party (CORWADO, 2026-10-07):
 * each request carries the buyer's name and phone so the farmer can call
 * them. Unanswered first, then newest; the most recent 200.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE],
    handler: async ({ auth }) => {
      const { farmerId } = farmerScope(auth);
      const rows = await prisma.$queryRawUnsafe<IncomingRow[]>(
        `SELECT ${INCOMING_COLUMNS} ${INCOMING_FROM}
          WHERE ${INCOMING_WHERE}
          ORDER BY (r.status IN ('submitted','under_review')) DESC, r.submitted_at DESC, r.id DESC
          LIMIT 200`,
        farmerId,
      );
      return ok(rows.map(presentIncoming));
    },
  },
});
