import { randomUUID } from 'node:crypto';

import {
  BUYER_ROLE,
  FARMER_ROLE,
  PROFILE_PHOTO_BUCKET,
  profilePhotoPath,
  profilePhotoUploadSchema,
} from '@agri-erp/shared';

import { unprocessable } from '../../../../../../lib/api/errors';
import { me } from '../../../../../../lib/api/messaging';
import { loadOwnProfile } from '../../../../../../lib/api/public-profile';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';
import { issueUploadGrant } from '../../../../../../lib/supabase/admin';

/**
 * POST /api/account/public-profile/photo/upload-url -- a signed upload grant
 * for a new profile photo (2026-10-23). The visit-attachment mechanism (B8,
 * C-8.8), reused: bytes never pass through a route. The type and size are
 * judged by the shared schema before any byte travels; the private bucket
 * enforces the same ceiling and types at upload; confirm checks what arrived.
 *
 * The path is the profile's PUBLIC id and a fresh upload id -- never the
 * sign-in id -- so a grant cannot overwrite the photo already shown. A profile
 * must be saved first (`profile_save_first`), because the path needs its id.
 *
 * Writes nothing to the database, so nothing to audit: the photo becomes the
 * profile's only at confirm, which is audited.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: profilePhotoUploadSchema,
    handler: async ({ auth, body }) => {
      const row = await loadOwnProfile(prisma, me(auth));
      if (!row) throw unprocessable('profile_save_first');
      const uploadId = randomUUID();
      const grant = await issueUploadGrant(
        PROFILE_PHOTO_BUCKET,
        profilePhotoPath(row.public_id, uploadId, body.content_type),
      );
      return ok({ upload_id: uploadId, url: grant.url, token: grant.token });
    },
  },
});
