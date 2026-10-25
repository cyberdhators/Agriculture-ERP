import {
  BUYER_ROLE,
  FARMER_ROLE,
  publicEnterpriseSize,
  type Activity,
  type PublicProfileView,
} from '@agri-erp/shared';

import { ApiFailure, notFound } from '../../../../../lib/api/errors';
import { checkId } from '../../../../../lib/api/market-posts';
import {
  PROFILE_COLUMNS,
  PROFILE_FROM,
  PUBLIC_PROFILE_WHERE,
  accountOfSignIn,
  expertiseOf,
  photoLink,
  postsOf,
  type ProfileRow,
} from '../../../../../lib/api/public-profile';
import { requireRole, type Authenticated } from '../../../../../lib/api/require-role';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/profiles/p/:publicId -- a PUBLISHED public profile, for anyone
 * (2026-10-23, public profiles v2). docs/DECISIONS.md, "Public profiles v2:
 * drafts, publishing, photo".
 *
 * ONLY A PUBLISHED PROFILE OF A LIVE ACCOUNT. A draft, an unpublished
 * profile, a suspended account and a removed (deleted) account are all the
 * house 404, the same as an address that never existed -- so a profile cannot
 * be confirmed to exist until its owner chooses to show it.
 *
 * WHAT IT SHOWS, a whitelist (the specification's list): the display name;
 * the photo as a read link that expires in minutes; what they do (activities,
 * profile kind); the general location (state and payam names); the about
 * text; products and services as short tags; the Verified badge; the month
 * they joined; and what they have on the market now, each post through its
 * own public presenter. `can_message` is the owner's "allow in-app messaging".
 *
 * THE PHONE, only when the owner chose "show phone number publicly" AND the
 * caller is a signed-in farmer or buyer -- the line the contact routes draw.
 * Never to an anonymous visitor. The session is read through requireRole (the
 * only place a session is read), as POST /api/support does; no session is a
 * visitor. NEVER a sign-in id, a farmer or buyer id, or a storage path.
 *
 * Public, read-only, writes nothing.
 */

/** The signed-in farmer or buyer, or null for a visitor. A 503 is passed on. */
async function callerOf(request: Request): Promise<Authenticated | null> {
  try {
    return await requireRole(request, [FARMER_ROLE, BUYER_ROLE]);
  } catch (failure) {
    if (failure instanceof ApiFailure && (failure.status === 401 || failure.status === 403)) {
      return null;
    }
    throw failure;
  }
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async ({ params, request }) => {
      // The sign-in id is read to find the account's posts and stays here.
      const [row] = await prisma.$queryRawUnsafe<(ProfileRow & { auth_user_id: string })[]>(
        `SELECT ${PROFILE_COLUMNS}, ap.auth_user_id ${PROFILE_FROM}
          WHERE ap.public_id = $1::uuid AND ${PUBLIC_PROFILE_WHERE}`,
        checkId(params.publicId),
      );
      if (!row || !row.display_name) throw notFound();

      const account = await accountOfSignIn(prisma, row.auth_user_id);
      const posts = await postsOf(prisma, account.farmer_id, account.buyer_id);
      const caller = row.show_phone ? await callerOf(request) : null;

      // Read before the whitelist, so the view never names the sign-in.
      const expertise = await expertiseOf(prisma, row.auth_user_id);
      const view: PublicProfileView = {
        public_id: row.public_id,
        display_name: row.display_name,
        photo_url: await photoLink(row.photo_path),
        activities: row.activities as Activity[],
        profile_kind: row.profile_kind,
        group_kind: row.group_kind,
        // 2026-10-27: only if the owner chose to show it (publicEnterpriseSize).
        enterprise_size: publicEnterpriseSize(
          row.profile_kind,
          row.enterprise_size,
          row.show_enterprise_size,
        ),
        location: { state: row.state_name, payam: row.payam_name },
        about: row.about,
        products: row.products,
        services: row.services,
        verified: account.verified,
        member_since: (account.member_since ?? new Date()).toISOString().slice(0, 7),
        can_message: row.allow_messages,
        phone: row.show_phone && caller ? account.phone : null,
        phone_on_sign_in: row.show_phone,
        listings: posts.listings,
        buying_requests: posts.buying_requests,
        service_listings: posts.services,
        expertise,
      };
      return ok(view);
    },
  },
});
