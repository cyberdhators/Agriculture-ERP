import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import {
  CORRECTION_SELECT,
  presentCorrection,
  reasonCodesSetting,
  type CorrectionRow,
} from '../../../../lib/api/listing-corrections';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/account/corrections -- the OPEN correction requests on this
 * account's own posts (2026-10-27): its produce listings, service listings
 * and buying requests, as farmer and as buyer (one account, many
 * activities). Each carries the reason and the moderator's note, so the owner
 * sees what to fix; the screens show "Correction requested" on those posts.
 * Keyed by the session's sign-in; nobody else's posts are read.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth }) => {
      const rows = await prisma.$queryRawUnsafe<CorrectionRow[]>(
        `WITH me AS (
           SELECT (SELECT array_agg(id) FROM public.farmer_active
                    WHERE auth_user_id = $1::uuid) AS farmer_ids,
                  (SELECT array_agg(id) FROM public.buyer_active
                    WHERE auth_user_id = $1::uuid) AS buyer_ids
         )
         ${CORRECTION_SELECT}
         CROSS JOIN me
         WHERE c.status = 'open'
           AND (pl.farmer_id = ANY (me.farmer_ids)
             OR sl.farmer_id = ANY (me.farmer_ids) OR sl.buyer_id = ANY (me.buyer_ids)
             OR br.farmer_id = ANY (me.farmer_ids) OR br.buyer_id = ANY (me.buyer_ids))
         ORDER BY c.requested_at DESC, c.id DESC
         LIMIT 100`,
        auth.principal.authUserId,
      );
      const setting = await reasonCodesSetting(prisma);
      return ok(rows.map((row) => presentCorrection(row, setting)));
    },
  },
});
