import {
  BUYER_ROLE,
  FARMER_ROLE,
  PROFILE_PHOTO_BUCKET,
  PROFILE_PHOTO_LIMITS,
  profilePhotoConfirmSchema,
  profilePhotoPath,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { conflict, unprocessable } from '../../../../../../lib/api/errors';
import { me } from '../../../../../../lib/api/messaging';
import {
  loadOwnProfile,
  presentOwnProfile,
  profileActor,
} from '../../../../../../lib/api/public-profile';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';
import { describeStoredObject, removeStoredObject } from '../../../../../../lib/supabase/admin';

/**
 * POST /api/account/public-profile/photo/confirm -- the screen says the photo
 * is up; the server checks (2026-10-23). The object must EXIST at the path the
 * grant was for, and the provider's own facts -- not the phone's claim -- must
 * be an accepted image type, the type declared, and at most 2 MB. Anything
 * else is removed and refused (`profile_photo_rejected`), so a grant is never
 * a grant to store anything. Not there yet is 409 `profile_photo_not_received`.
 *
 * Then the profile points at the new photo, and the old object, if any, is
 * removed (best effort: nothing depends on it, and it is no longer shown).
 * Audited as `profile.photo_changed` -- whether there was a photo before, never
 * a path.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: profilePhotoConfirmSchema,
    handler: async ({ auth, body }) => {
      const owner = me(auth);
      const row = await loadOwnProfile(prisma, owner);
      if (!row) throw unprocessable('profile_save_first');
      const path = profilePhotoPath(row.public_id, body.upload_id, body.content_type);
      if (row.photo_path === path) {
        return ok(await presentOwnProfile(prisma, owner, row)); // a retried confirm
      }

      const stored = await describeStoredObject(PROFILE_PHOTO_BUCKET, path);
      if (!stored) throw conflict('profile_photo_not_received');
      const type = (stored.contentType ?? '').toLowerCase().split(';')[0]?.trim();
      if (
        type !== body.content_type ||
        stored.byteSize === null ||
        stored.byteSize > PROFILE_PHOTO_LIMITS.maxBytes
      ) {
        await removeStoredObject(PROFILE_PHOTO_BUCKET, path).catch(() => {});
        throw unprocessable('profile_photo_rejected');
      }

      const previous = await audited(prisma, async (tx) => {
        const current = await loadOwnProfile(tx, owner, true);
        if (!current) throw unprocessable('profile_save_first');
        await tx.$executeRawUnsafe(
          `UPDATE public.account_profile
              SET photo_path = $2, photo_updated_at = now(), updated_at = now()
            WHERE auth_user_id = $1::uuid`,
          owner,
          path,
        );
        await writeAudit(tx, {
          entityType: 'account_profile',
          entityId: current.public_id,
          ...profileActor(auth),
          action: 'profile.photo_changed',
          before: { had_photo: current.photo_path !== null },
          after: { had_photo: true, content_type: body.content_type },
        });
        return current.photo_path;
      });
      if (previous && previous !== path) {
        await removeStoredObject(PROFILE_PHOTO_BUCKET, previous).catch(() => {});
      }
      return ok(await presentOwnProfile(prisma, owner, await loadOwnProfile(prisma, owner)));
    },
  },
});
