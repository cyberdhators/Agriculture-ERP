import { BUYER_ROLE, FARMER_ROLE, PROFILE_PHOTO_BUCKET } from '@agri-erp/shared';

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
import { removeStoredObject } from '../../../../../lib/supabase/admin';

/**
 * DELETE /api/account/public-profile/photo -- the owner removes their photo
 * (2026-10-23). The photo is optional: the profile shows initials instead.
 *
 * The profile's record is never deleted: the column is cleared (with the time,
 * in photo_updated_at) and audited as `profile.photo_removed`. The stored
 * object is then removed, best effort -- once cleared it is shown to nobody.
 * No photo already: nothing changes and nothing is written.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  DELETE: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth }) => {
      const owner = me(auth);
      const removed = await audited(prisma, async (tx) => {
        const row = await loadOwnProfile(tx, owner, true);
        if (!row) throw notFound();
        if (!row.photo_path) return null;
        await tx.$executeRawUnsafe(
          `UPDATE public.account_profile
              SET photo_path = NULL, photo_updated_at = now(), updated_at = now()
            WHERE auth_user_id = $1::uuid`,
          owner,
        );
        await writeAudit(tx, {
          entityType: 'account_profile',
          entityId: row.public_id,
          ...profileActor(auth),
          action: 'profile.photo_removed',
          before: { had_photo: true },
          after: { had_photo: false },
        });
        return row.photo_path;
      });
      if (removed) await removeStoredObject(PROFILE_PHOTO_BUCKET, removed).catch(() => {});
      return ok(await presentOwnProfile(prisma, owner, await loadOwnProfile(prisma, owner)));
    },
  },
});
