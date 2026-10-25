import { ORG_PRESET_LABELS, type OrgPreset } from '@agri-erp/shared';

import { notFound } from '../../../../../lib/api/errors';
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
import { PERSON_NAME_SQL } from '../../../../../lib/api/organizations';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/organizations/:id/profile -- an organisation's PUBLIC profile
 * (2026-10-27). Public: no sign-in. Only a published, open organisation is
 * shown; a draft, a closed or a removed one is 404 like a missing one.
 *
 * A WHITELIST. Name, kind, activities, description, general location, the
 * public contacts the organisation chose to give, its posts on the market --
 * and its team ONLY when the organisation turned "show team" on AND each
 * listed person agreed themselves (show_on_profile). A member is shown as
 * "Mary K." with their title and role; never a phone, an email or an id.
 * Public visibility is not endorsement by CORWADO.
 */
interface ProfileRow {
  id: string;
  name: string;
  profile_kind: string;
  group_kind: string | null;
  activities: string[];
  about: string | null;
  state_name: string | null;
  location: string | null;
  public_phone: string | null;
  public_email: string | null;
  show_team: boolean;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async ({ params }) => {
      const id = checkId(params.id);
      const [org] = await prisma.$queryRawUnsafe<ProfileRow[]>(
        `SELECT o.id, o.name, o.profile_kind, o.group_kind, o.activities, o.about,
                s.name AS state_name, o.location, o.public_phone, o.public_email, o.show_team
           FROM public.organization o
           LEFT JOIN public.state s ON s.id = o.state_id
          WHERE o.id = $1::uuid AND o.deleted_at IS NULL AND o.closed_at IS NULL
            AND o.status = 'published'`,
        id,
      );
      if (!org) throw notFound();

      const team = org.show_team
        ? await prisma.$queryRawUnsafe<
            { name: string; public_title: string | null; preset: OrgPreset }[]
          >(
            `SELECT ${PERSON_NAME_SQL('m.auth_user_id')} AS name, m.public_title, m.preset
               FROM public.organization_member m
              WHERE m.organization_id = $1::uuid AND m.status = 'active'
                AND m.show_on_profile = true
              ORDER BY m.joined_at, m.id LIMIT 50`,
            id,
          )
        : [];
      const services = await prisma.$queryRawUnsafe<ServiceRow[]>(
        `SELECT ${SERVICE_COLUMNS} ${SERVICE_FROM}
          WHERE sl.organization_id = $1::uuid AND ${SERVICE_MARKET_WHERE}
          ORDER BY sl.updated_at DESC, sl.id DESC LIMIT 20`,
        id,
      );
      const requests = await prisma.$queryRawUnsafe<BuyingRequestRow[]>(
        `SELECT ${BUYING_REQUEST_COLUMNS} ${BUYING_REQUEST_FROM}
          WHERE br.organization_id = $1::uuid AND ${BUYING_REQUEST_MARKET_WHERE}
          ORDER BY br.updated_at DESC, br.id DESC LIMIT 20`,
        id,
      );
      return ok({
        id: org.id,
        name: org.name,
        profile_kind: org.profile_kind,
        group_kind: org.group_kind,
        activities: org.activities,
        about: org.about,
        state_name: org.state_name,
        location: org.location,
        public_phone: org.public_phone,
        public_email: org.public_email,
        team: team.map((m) => ({
          name: m.name,
          title: m.public_title,
          role: ORG_PRESET_LABELS[m.preset],
        })),
        services: services.map(presentService),
        buying_requests: requests.map(presentBuyingRequest),
      });
    },
  },
});
