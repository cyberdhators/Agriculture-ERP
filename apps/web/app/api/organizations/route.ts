import {
  BUYER_ROLE,
  FARMER_ROLE,
  MARKET_POST_MESSAGES,
  createOrganizationSchema,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../lib/api/audit';
import { invalidField } from '../../../lib/api/market-posts';
import {
  ORGANIZATION_COLUMNS,
  actorFor,
  loadOrganization,
  personOf,
  presentMine,
  presentOrganization,
  type MemberRow,
  type OrganizationRow,
} from '../../../lib/api/organizations';
import { created, defineRoutes, paged } from '../../../lib/api/route';
import { prisma } from '../../../lib/db';

type MemberColumns = Pick<
  MemberRow,
  'preset' | 'permissions' | 'show_on_profile' | 'public_title'
> & { member_id: string; sole_administrator: boolean };

/**
 * /api/organizations -- the organisations the caller belongs to, and
 * "Create an organisation profile" (2026-10-27, team access).
 *
 * GET lists the caller's ACTIVE memberships, open and closed organisations
 * alike (a closed one shows as closed). Nobody sees an organisation they are
 * not a member of here.
 *
 * POST creates an organisation. Any account may: a farmer sign-in or a buyer
 * sign-in, a person on their own initiative -- no CORWADO approval. The
 * creator becomes its first Administrator in the same transaction, so an
 * organisation never exists without one. It starts as a draft: the public
 * profile is shown only once an administrator publishes it.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth }) => {
      const me = personOf(auth);
      const rows = await prisma.$queryRawUnsafe<(OrganizationRow & MemberColumns)[]>(
        `SELECT ${ORGANIZATION_COLUMNS}, m.id AS member_id, m.preset, m.permissions,
                m.show_on_profile, m.public_title,
                (m.preset = 'administrator' AND (
                  SELECT count(*) FROM public.organization_member a
                   WHERE a.organization_id = o.id AND a.status = 'active'
                     AND a.preset = 'administrator') = 1) AS sole_administrator
           FROM public.organization_member m
           JOIN public.organization o ON o.id = m.organization_id AND o.deleted_at IS NULL
          WHERE m.auth_user_id = $1::uuid AND m.status = 'active'
          ORDER BY (o.closed_at IS NULL) DESC, o.name, o.id
          LIMIT 100`,
        me,
      );
      return paged(
        rows.map((row) => ({
          ...presentOrganization(row),
          member_id: row.member_id,
          preset: row.preset,
          permissions: row.permissions,
          show_on_profile: row.show_on_profile,
          public_title: row.public_title,
          // Personal deletion asks about these: close them, or hand over first.
          sole_administrator: row.sole_administrator && row.closed_at === null,
        })),
        { cursor: null, hasMore: false },
      );
    },
  },

  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: createOrganizationSchema,
    handler: async ({ auth, body }) => {
      const me = personOf(auth);
      if (body.state_id) {
        const [state] = await prisma.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM public.state WHERE id = $1 AND deleted_at IS NULL',
          body.state_id,
        );
        if (!state) throw invalidField('state_id', MARKET_POST_MESSAGES.stateUnknown);
      }
      const result = await audited(prisma, async (tx) => {
        const [org] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.organization
             (name, profile_kind, group_kind, activities, about, state_id, location,
              public_phone, public_email, show_team, created_by)
           VALUES ($1, $2, $3, $4::text[], $5, $6, $7, $8, $9, $10, $11::uuid)
           RETURNING id`,
          body.name,
          body.profile_kind,
          body.group_kind ?? null,
          body.activities,
          body.about ?? null,
          body.state_id ?? null,
          body.location ?? null,
          body.public_phone ?? null,
          body.public_email ?? null,
          body.show_team ?? false,
          me,
        );
        const id = org!.id;
        const [member] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.organization_member
             (organization_id, auth_user_id, preset, permissions)
           VALUES ($1::uuid, $2::uuid, 'administrator',
                   ARRAY['profile.edit','listings.manage','inbox.read','inbox.reply',
                         'advisory.handle','team.manage']::text[])
           RETURNING id`,
          id,
          me,
        );
        await writeAudit(tx, {
          entityType: 'organization',
          entityId: id,
          ...actorFor(auth),
          action: 'organization.created',
          after: {
            name: body.name,
            profile_kind: body.profile_kind,
            group_kind: body.group_kind ?? null,
            activities: body.activities,
            status: 'draft',
          },
        });
        await writeAudit(tx, {
          entityType: 'organization_member',
          entityId: member!.id,
          ...actorFor(auth),
          action: 'organization_member.joined',
          after: { organization_id: id, preset: 'administrator', as: 'creator' },
        });
        const organization = await loadOrganization(tx, id);
        const [row] = await tx.$queryRawUnsafe<MemberRow[]>(
          `SELECT id, organization_id, auth_user_id, preset, permissions, status,
                  show_on_profile, public_title, joined_at, ended_at, end_reason
             FROM public.organization_member WHERE id = $1::uuid`,
          member!.id,
        );
        return presentMine(organization, row!);
      });
      return created(result);
    },
  },
});
