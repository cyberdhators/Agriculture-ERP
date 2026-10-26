import { POST_KINDS, type PostKind } from '@agri-erp/shared';

import { notFound } from '../../../../../lib/api/errors';
import {
  MARKET_BASE_WHERE,
  MARKET_COLUMNS,
  MARKET_FROM,
  presentMarketListing,
  type MarketRow,
} from '../../../../../lib/api/buyer-presenters';
import {
  BUYING_REQUEST_COLUMNS,
  BUYING_REQUEST_FROM,
  BUYING_REQUEST_MARKET_WHERE,
  SERVICE_COLUMNS,
  SERVICE_FROM,
  SERVICE_MARKET_WHERE,
  checkId,
  presentBuyingRequest,
  presentService,
  type BuyingRequestRow,
  type ServiceRow,
} from '../../../../../lib/api/market-posts';
import { expertiseOf } from '../../../../../lib/api/public-profile';
import { PUBLIC_PROFILE_WHERE } from '../../../../../lib/api/public-profile-sql';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/profiles/:kind/:id -- the public profile of whoever posted one post
 * on the market (2026-10-20, CORWADO's 16 October specification: public
 * profiles). The owner, 2026-10-20: name, place, badge, posts.
 *
 * REACHED THROUGH A POST, NEVER AN ACCOUNT ID. The address is the post that
 * led here, so no farmer, buyer or sign-in id is ever printed or accepted;
 * a post that is not on the market (a draft, paused, expired, withdrawn, or
 * its owner removed) is 404, so a profile cannot be found through one.
 *
 * WHAT IT SHOWS, a whitelist: the post's market name; payam and state for a
 * farmer, the organisation's state for a buyer; the Verified badge; the month
 * they joined; "who you are, what you do" if they answered it; and what they
 * have on the market now, each through its own public presenter. Never a
 * phone, a legal name, an id other than a post's, or anything private.
 *
 * 2026-10-23: plus `profile_id`, the public id of the owner's public profile
 * when (and only when) it is PUBLISHED, so the screen sends the visitor there
 * (GET /api/profiles/p/:publicId). An unpublished profile adds nothing here.
 *
 * Public, read-only, writes nothing.
 */

interface Owner {
  name: string;
  farmer_id: string | null;
  buyer_id: string | null;
}

const OWNER_SQL: Record<PostKind, string> = {
  listing: `SELECT pl.trading_name AS name, pl.farmer_id, NULL::uuid AS buyer_id
    ${MARKET_FROM} WHERE pl.id = $1::uuid AND ${MARKET_BASE_WHERE}`,
  buying_request: `SELECT br.display_name AS name, f.id AS farmer_id, b.id AS buyer_id
    ${BUYING_REQUEST_FROM} WHERE br.id = $1::uuid AND ${BUYING_REQUEST_MARKET_WHERE}`,
  // 2026-10-26: a service may be a farmer's or a buyer account's.
  service: `SELECT sl.trading_name AS name, f.id AS farmer_id, b.id AS buyer_id
    ${SERVICE_FROM} WHERE sl.id = $1::uuid AND ${SERVICE_MARKET_WHERE}`,
};

interface Account {
  farmer_id: string | null;
  buyer_id: string | null;
  auth_user_id: string | null;
  verified_organisation: boolean;
  payam_name: string | null;
  state_name: string | null;
  member_since: Date;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async ({ params }) => {
      const kind = params.kind as PostKind;
      if (!(POST_KINDS as readonly string[]).includes(kind)) throw notFound();
      const [owner] = await prisma.$queryRawUnsafe<Owner[]>(OWNER_SQL[kind], checkId(params.id));
      if (!owner) throw notFound();

      // One account may hold a farmer and a buyer record (#178): the profile is
      // the account's, so both sides' posts are on it.
      const [account] = await prisma.$queryRawUnsafe<Account[]>(
        `WITH start AS (
           SELECT auth_user_id FROM public.farmer_active WHERE id = $1::uuid
           UNION ALL
           SELECT auth_user_id FROM public.buyer_active WHERE id = $2::uuid
         ),
         me AS (SELECT auth_user_id FROM start LIMIT 1),
         f AS (
           SELECT fa.* FROM public.farmer_active fa
            WHERE fa.id = $1::uuid
               OR (fa.auth_user_id IS NOT NULL AND fa.auth_user_id = (SELECT auth_user_id FROM me))
            LIMIT 1
         ),
         b AS (
           SELECT ba.* FROM public.buyer_active ba
            WHERE ba.id = $2::uuid OR ba.auth_user_id = (SELECT auth_user_id FROM me)
            LIMIT 1
         )
         SELECT (SELECT id FROM f) AS farmer_id,
                (SELECT id FROM b) AS buyer_id,
                (SELECT auth_user_id FROM me) AS auth_user_id,
                -- 2026-10-31: only an organisation is verified -- the buyer's
                -- organisation when it is a verified business; never a person.
                COALESCE((SELECT o.account_type::text <> 'individual'
                                 AND o.verification_status::text = 'verified'
                            FROM b JOIN public.buyer_organization_active o ON o.id = b.organization_id),
                         false) AS verified_organisation,
                (SELECT pm.name FROM f JOIN public.payam pm ON pm.id = f.payam_id) AS payam_name,
                COALESCE(
                  (SELECT s.name FROM f JOIN public.state s ON s.id = f.state_id),
                  (SELECT s.name FROM b JOIN public.buyer_organization_active o ON o.id = b.organization_id
                     JOIN public.state s ON s.id = o.state_id)
                ) AS state_name,
                LEAST((SELECT created_at FROM f), (SELECT created_at FROM b)) AS member_since`,
        owner.farmer_id,
        owner.buyer_id,
      );
      if (!account) throw notFound();

      const [about] = account.auth_user_id
        ? await prisma.$queryRawUnsafe<
            { profile_kind: string; group_kind: string | null; activities: string[] }[]
          >(
            `SELECT profile_kind, group_kind, activities FROM public.account_profile
              WHERE auth_user_id = $1::uuid`,
            account.auth_user_id,
          )
        : [];

      const listings = account.farmer_id
        ? await prisma.$queryRawUnsafe<MarketRow[]>(
            `SELECT ${MARKET_COLUMNS} ${MARKET_FROM}
              WHERE pl.farmer_id = $1::uuid AND ${MARKET_BASE_WHERE}
              ORDER BY pl.updated_at DESC LIMIT 50`,
            account.farmer_id,
          )
        : [];
      const requests = await prisma.$queryRawUnsafe<BuyingRequestRow[]>(
        `SELECT ${BUYING_REQUEST_COLUMNS} ${BUYING_REQUEST_FROM}
          WHERE (br.farmer_id = $1::uuid OR br.buyer_id = $2::uuid)
            AND ${BUYING_REQUEST_MARKET_WHERE}
          ORDER BY br.updated_at DESC LIMIT 50`,
        account.farmer_id,
        account.buyer_id,
      );
      const services = await prisma.$queryRawUnsafe<ServiceRow[]>(
        `SELECT ${SERVICE_COLUMNS} ${SERVICE_FROM}
          WHERE (sl.farmer_id = $1::uuid OR sl.buyer_id = $2::uuid)
            AND ${SERVICE_MARKET_WHERE}
          ORDER BY sl.updated_at DESC LIMIT 50`,
        account.farmer_id,
        account.buyer_id,
      );

      // 2026-10-23 (public profiles v2): when the owner has PUBLISHED a public
      // profile, its public id, so the screen can go there. Nothing else of it:
      // a draft or unpublished profile's name, photo and text never leave here.
      const [published] = account.auth_user_id
        ? await prisma.$queryRawUnsafe<{ public_id: string }[]>(
            `SELECT ap.public_id FROM public.account_profile ap
              WHERE ap.auth_user_id = $1::uuid AND ${PUBLIC_PROFILE_WHERE}`,
            account.auth_user_id,
          )
        : [];

      return ok({
        profile_id: published?.public_id ?? null,
        name: owner.name,
        verified_organisation: account.verified_organisation,
        place: { payam: account.payam_name, state: account.state_name },
        member_since: account.member_since.toISOString().slice(0, 7),
        about: about
          ? {
              profile_kind: about.profile_kind,
              group_kind: about.group_kind,
              activities: about.activities,
            }
          : null,
        listings: listings.map(presentMarketListing),
        buying_requests: requests.map(presentBuyingRequest),
        services: services.map(presentService),
        // 2026-10-28 (infographic no. 5): topics of a published advice profile, and the badge.
        expertise: await expertiseOf(prisma, account.auth_user_id),
      });
    },
  },
});
