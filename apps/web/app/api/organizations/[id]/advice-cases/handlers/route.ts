import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import { checkId } from '../../../../../../lib/api/market-posts';
import { listHandlers, requireHandler } from '../../../../../../lib/api/organization-advice';
import { personOf } from '../../../../../../lib/api/organizations';
import { defineRoutes, paged } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';

/**
 * GET /api/organizations/:id/advice-cases/handlers -- the members a request
 * can be given to: active, holding `advisory.handle` (2026-10-28). For the
 * organisation's handlers only. Names as members see each other ("Mary K."),
 * never a phone.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params }) => {
      const person = personOf(auth);
      const { organization } = await requireHandler(prisma, checkId(params.id), person);
      return paged(await listHandlers(prisma, organization.id, person), {
        cursor: null,
        hasMore: false,
      });
    },
  },
});
