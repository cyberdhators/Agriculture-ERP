import { MARKET_POST_MESSAGES, SANCTION_KINDS, type SanctionKind } from '@agri-erp/shared';

import { checkId, invalidField } from '../../../../../lib/api/market-posts';
import { accountOf } from '../../../../../lib/api/moderation';
import { requirePermission } from '../../../../../lib/api/permissions';
import { loadOwnProfile, photoLink } from '../../../../../lib/api/public-profile';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/admin/accounts/public-profile?kind=farmer|buyer&id=<uuid> -- the
 * public profile of the account behind a farmer or buyer record, as staff
 * moderating it see it (2026-10-23, public profiles v2): its status, its
 * display name, its photo (a read link that expires) and its public address.
 * For the Account box on a farmer's record and on a buyer. Administrators
 * holding "Moderate content and listings", like suspension.
 *
 * Read-only. Staff never edit or publish a profile: that is the owner's alone
 * (no staff approval). The one staff action is removing a photo, through
 * POST .../remove-photo.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth, request }) => {
      await requirePermission(auth, 'content.moderate');
      const params = new URL(request.url).searchParams;
      const kind = params.get('kind') ?? '';
      if (!(SANCTION_KINDS as readonly string[]).includes(kind)) {
        throw invalidField('kind', MARKET_POST_MESSAGES.posterUnknown);
      }
      const account = await accountOf(
        prisma,
        kind as SanctionKind,
        checkId(params.get('id') ?? undefined),
      );
      const row = account.authUserId ? await loadOwnProfile(prisma, account.authUserId) : undefined;
      if (!row) return ok({ exists: false });
      return ok({
        exists: true,
        public_id: row.public_id,
        status: row.status,
        published_at: row.published_at ? row.published_at.toISOString() : null,
        display_name: row.display_name,
        has_photo: row.photo_path !== null,
        photo_url: await photoLink(row.photo_path),
      });
    },
  },
});
