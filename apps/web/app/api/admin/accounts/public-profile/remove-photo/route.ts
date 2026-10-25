import { PROFILE_PHOTO_BUCKET, accountSanctionSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../../lib/api/errors';
import { accountOf } from '../../../../../../lib/api/moderation';
import { requirePermission } from '../../../../../../lib/api/permissions';
import { loadOwnProfile } from '../../../../../../lib/api/public-profile';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';
import { removeStoredObject } from '../../../../../../lib/supabase/admin';

/**
 * POST /api/admin/accounts/public-profile/remove-photo -- staff remove the
 * photo from an account's public profile (2026-10-23, public profiles v2), for
 * a photo that should not be public (reported, inappropriate, someone else's).
 * Administrators holding "Moderate content and listings". The body is the
 * suspension body: the record looked at (farmer or buyer) and a reason.
 *
 * Only the photo: the profile itself stays as its owner left it, showing
 * initials, and the owner may add another photo. The column is cleared (the
 * record is never deleted) and audited as `profile.photo_removed_by_staff`
 * with the reason; then the stored object is removed, best effort. No photo
 * is `profile_no_photo`; an account with no profile is 404.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: accountSanctionSchema,
    handler: async ({ auth, body }) => {
      await requirePermission(auth, 'content.moderate');
      const removed = await audited(prisma, async (tx) => {
        const account = await accountOf(tx, body.kind, body.id);
        if (!account.authUserId) throw notFound();
        const row = await loadOwnProfile(tx, account.authUserId, true);
        if (!row) throw notFound();
        if (!row.photo_path) throw unprocessable('profile_no_photo');
        await tx.$executeRawUnsafe(
          `UPDATE public.account_profile
              SET photo_path = NULL, photo_updated_at = now(), updated_at = now()
            WHERE auth_user_id = $1::uuid`,
          account.authUserId,
        );
        await writeAudit(tx, {
          entityType: 'account_profile',
          entityId: row.public_id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'profile.photo_removed_by_staff',
          before: { had_photo: true },
          after: { had_photo: false, reason: body.reason, record_kind: body.kind },
        });
        return row.photo_path;
      });
      await removeStoredObject(PROFILE_PHOTO_BUCKET, removed).catch(() => {});
      return ok({ removed: true });
    },
  },
});
