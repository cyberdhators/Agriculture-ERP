import { BUYER_ROLE, FARMER_ROLE, emptyBodySchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { notFound } from '../../../../../lib/api/errors';
import { me } from '../../../../../lib/api/messaging';
import {
  loadOwnProfile,
  presentOwnProfile,
  profileActor,
} from '../../../../../lib/api/public-profile';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/account/public-profile/unpublish -- the owner takes their profile
 * off public view (2026-10-23). It is kept, as `unpublished`, and can be
 * edited and published again; nothing is deleted. Its posts stay on the market
 * under their own market names, as before profiles existed.
 *
 * Not published already: nothing changes and nothing is written. None saved
 * at all is 404. Audited as `profile.unpublished` (statuses only).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: emptyBodySchema,
    handler: async ({ auth }) => {
      const owner = me(auth);
      await audited(prisma, async (tx) => {
        const row = await loadOwnProfile(tx, owner, true);
        if (!row) throw notFound();
        if (row.status !== 'published') return;
        await tx.$executeRawUnsafe(
          `UPDATE public.account_profile
              SET status = 'unpublished', updated_at = now()
            WHERE auth_user_id = $1::uuid`,
          owner,
        );
        await writeAudit(tx, {
          entityType: 'account_profile',
          entityId: row.public_id,
          ...profileActor(auth),
          action: 'profile.unpublished',
          before: { status: 'published' },
          after: { status: 'unpublished' },
        });
      });
      return ok(await presentOwnProfile(prisma, owner, await loadOwnProfile(prisma, owner)));
    },
  },
});
