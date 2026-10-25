import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import { checkId } from '../../../../../lib/api/market-posts';
import {
  loadMembers,
  personOf,
  presentMember,
  requireMember,
} from '../../../../../lib/api/organizations';
import { defineRoutes, paged } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/organizations/:id/members -- the team (2026-10-27): every member,
 * current first, then those whose access ended, with when and why. For active
 * members of the organisation only (404 otherwise). Names are "Mary K.";
 * never a phone or an email. Ended memberships stay listed: removing someone's
 * access keeps the organisation's history.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params }) => {
      const me = personOf(auth);
      const { organization } = await requireMember(prisma, checkId(params.id), me);
      const rows = await loadMembers(prisma, organization.id);
      return paged(
        rows.map((row) => presentMember(row, me)),
        { cursor: null, hasMore: false },
      );
    },
  },
});
