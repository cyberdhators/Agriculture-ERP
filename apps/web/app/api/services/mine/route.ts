import { FARMER_ROLE } from '@agri-erp/shared';

import {
  OWN_SERVICE_COLUMNS,
  SERVICE_FROM,
  presentOwnService,
  type ServiceRow,
} from '../../../../lib/api/market-posts';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { farmerScope } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/services/mine -- the signed-in farmer's own service listings,
 * every status, newest change first (at most 200). LISTINGS LANE (2026-10-19).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE],
    handler: async ({ auth }) => {
      const { farmerId } = farmerScope(auth);
      const rows = await prisma.$queryRawUnsafe<(ServiceRow & { contact_phone: string })[]>(
        `SELECT ${OWN_SERVICE_COLUMNS} ${SERVICE_FROM}
          WHERE sl.farmer_id = $1::uuid
          ORDER BY sl.updated_at DESC, sl.id DESC LIMIT 200`,
        farmerId,
      );
      return ok(rows.map(presentOwnService));
    },
  },
});
