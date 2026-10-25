import { BUYER_ROLE, FARMER_ROLE, orgAdviceListSchema } from '@agri-erp/shared';

import { checkId, parseQuery } from '../../../../../lib/api/market-posts';
import {
  listOrgCases,
  presentOrgCase,
  requireHandler,
} from '../../../../../lib/api/organization-advice';
import { personOf } from '../../../../../lib/api/organizations';
import { defineRoutes, paged } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/organizations/:id/advice-cases?status=open|in_progress|closed --
 * the organisation's SHARED ADVICE INBOX (2026-10-28): requests asked of the
 * organisation's advice profile, newest first, at most 200 per tab.
 *
 * Only active members holding `advisory.handle` (404 to non-members, 403 to
 * members without it), re-checked on every request. A closed organisation's
 * cases stay readable to its handlers; acting on them is refused.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params, request }) => {
      const person = personOf(auth);
      const { organization, caller } = await requireHandler(prisma, checkId(params.id), person);
      const { status } = parseQuery(request, orgAdviceListSchema);
      const rows = await listOrgCases(prisma, organization.id, status);
      return paged(
        rows.map((row) => presentOrgCase(row, caller)),
        { cursor: null, hasMore: false },
      );
    },
  },
});
