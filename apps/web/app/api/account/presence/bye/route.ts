import { BUYER_ROLE, FARMER_ROLE, emptyBodySchema } from '@agri-erp/shared';

import { recordPresenceBye } from '../../../../../lib/api/activity';
import { defineRoutes, ok } from '../../../../../lib/api/route';

/**
 * POST /api/account/presence/bye (2026-11-01) -- the app says it was just
 * closed or hidden (a beacon on pagehide, or visibilitychange to hidden), so
 * the other person in a conversation can read an exact "Active 2 minutes
 * ago" rather than a five-minute guess. docs/DECISIONS.md, "Online status:
 * exact last seen, live in an open chat".
 *
 * For the session's OWN account only: nothing in the body (it must be `{}`)
 * names anyone. At most one write per account per 30 seconds; a time only,
 * never shown except under the reciprocal "Show when I'm active" rule
 * (lib/api/presence.ts). The answer says only whether it was recorded.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: emptyBodySchema,
    handler: async ({ auth }) => {
      const recorded = await recordPresenceBye(auth);
      return ok({ recorded }, { 'cache-control': 'no-store' });
    },
  },
});
