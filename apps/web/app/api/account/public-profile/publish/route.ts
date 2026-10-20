import { BUYER_ROLE, FARMER_ROLE, emptyBodySchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../lib/api/errors';
import { me } from '../../../../../lib/api/messaging';
import {
  loadOwnProfile,
  presentOwnProfile,
  profileActor,
} from '../../../../../lib/api/public-profile';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/account/public-profile/publish -- the owner publishes their
 * profile (2026-10-23). The deliberate step the specification asks for:
 * "Public profiles remain drafts until previewed and deliberately published."
 * The owner's confirmation, not staff approval -- nobody reviews it first, and
 * public visibility is not an endorsement.
 *
 * A profile with no saved name cannot be published (`profile_name_required`);
 * none saved at all is 404. Publishing a published profile changes nothing and
 * writes nothing. Audited as `profile.published` (statuses only).
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
        if (!row.display_name) throw unprocessable('profile_name_required');
        if (row.status === 'published') return;
        await tx.$executeRawUnsafe(
          `UPDATE public.account_profile
              SET status = 'published', published_at = now(), updated_at = now()
            WHERE auth_user_id = $1::uuid`,
          owner,
        );
        await writeAudit(tx, {
          entityType: 'account_profile',
          entityId: row.public_id,
          ...profileActor(auth),
          action: 'profile.published',
          before: { status: row.status },
          after: { status: 'published' },
        });
      });
      return ok(await presentOwnProfile(prisma, owner, await loadOwnProfile(prisma, owner)));
    },
  },
});
