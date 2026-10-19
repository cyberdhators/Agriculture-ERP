import { MARKET_POST_MESSAGES, SANCTION_KINDS, type SanctionKind } from '@agri-erp/shared';

import { accountOf, standingOf } from '../../../../../lib/api/moderation';
import { checkId, invalidField } from '../../../../../lib/api/market-posts';
import { requirePermission } from '../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/admin/accounts/standing?kind=farmer|buyer&id=<uuid> -- whether the
 * account behind a record is suspended, and why (2026-10-21). For the
 * Suspend/Restore box on a farmer's record and on a buyer. Administrators
 * holding "Moderate content and listings".
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ auth, request }) => {
      await requirePermission(auth, 'content.moderate');
      const params = new URL(request.url).searchParams;
      const kind = params.get('kind') ?? '';
      if (!(SANCTION_KINDS as readonly string[]).includes(kind)) {
        throw invalidField('kind', MARKET_POST_MESSAGES.posterUnknown);
      }
      const id = checkId(params.get('id') ?? undefined);
      return ok(standingOf(await accountOf(prisma, kind as SanctionKind, id)));
    },
  },
});
