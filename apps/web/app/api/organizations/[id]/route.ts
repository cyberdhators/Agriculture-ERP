import {
  ACCOUNT_PROFILE_MESSAGES,
  BUYER_ROLE,
  FARMER_ROLE,
  MARKET_POST_MESSAGES,
  needsSecondAdministrator,
  updateOrganizationSchema,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { checkId, invalidField } from '../../../../lib/api/market-posts';
import {
  actorFor,
  asMember,
  loadMembers,
  loadOrganization,
  personOf,
  presentMine,
  requireMember,
} from '../../../../lib/api/organizations';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * /api/organizations/:id -- one organisation, for its members (2026-10-27).
 *
 * GET: the profile and the caller's own membership, plus whether the team
 * should be encouraged to add a second administrator. 404 to anyone who is
 * not an active member.
 *
 * PATCH: edit the profile, or publish / unpublish it -- `profile.edit`. A
 * closed organisation cannot be changed. Publishing needs nothing from
 * CORWADO: public visibility is not endorsement.
 */
const COLUMNS: Record<string, string> = {
  name: 'name',
  profile_kind: 'profile_kind',
  group_kind: 'group_kind',
  activities: 'activities',
  about: 'about',
  state_id: 'state_id',
  location: 'location',
  public_phone: 'public_phone',
  public_email: 'public_email',
  show_team: 'show_team',
  status: 'status',
};

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params }) => {
      const me = personOf(auth);
      const { organization, member } = await requireMember(prisma, checkId(params.id), me);
      const members = await loadMembers(prisma, organization.id);
      return ok({
        ...presentMine(organization, member),
        needs_second_administrator: needsSecondAdministrator(members.map(asMember)),
      });
    },
  },

  PATCH: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: updateOrganizationSchema,
    handler: async ({ auth, params, body }) => {
      const me = personOf(auth);
      const id = checkId(params.id);
      if (body.state_id) {
        const [state] = await prisma.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM public.state WHERE id = $1 AND deleted_at IS NULL',
          body.state_id,
        );
        if (!state) throw invalidField('state_id', MARKET_POST_MESSAGES.stateUnknown);
      }
      const result = await audited(prisma, async (tx) => {
        const { organization: current, member } = await requireMember(tx, id, me, {
          permission: 'profile.edit',
          open: true,
          lock: true,
        });

        // The kind and the group kind are judged together, as they will stand.
        const kind = body.profile_kind ?? current.profile_kind;
        const groupKind =
          body.group_kind !== undefined
            ? body.group_kind
            : body.profile_kind !== undefined && body.profile_kind !== 'group'
              ? null
              : current.group_kind;
        if (kind === 'group' && !groupKind) {
          throw invalidField('group_kind', ACCOUNT_PROFILE_MESSAGES.groupKindRequired);
        }
        if (kind !== 'group' && groupKind) {
          throw invalidField('group_kind', ACCOUNT_PROFILE_MESSAGES.groupKindOnlyForGroups);
        }
        const changes: Record<string, unknown> = { ...body, group_kind: groupKind };

        const sets: string[] = [];
        const values: unknown[] = [id];
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(changes)) {
          const column = COLUMNS[key];
          if (!column || value === undefined) continue;
          const old = (current as unknown as Record<string, unknown>)[key];
          if (JSON.stringify(old ?? null) === JSON.stringify(value ?? null)) continue;
          values.push(value ?? null);
          sets.push(`${column} = $${values.length}${key === 'activities' ? '::text[]' : ''}`);
          before[key] = old ?? null;
          after[key] = value ?? null;
        }
        if (sets.length === 0) return presentMine(current, member);
        if (after.status === 'published') sets.push('published_at = now()');
        await tx.$queryRawUnsafe(
          `UPDATE public.organization SET ${sets.join(', ')}, updated_at = now()
            WHERE id = $1::uuid`,
          ...values,
        );
        const statusChange = after.status as string | undefined;
        await writeAudit(tx, {
          entityType: 'organization',
          entityId: id,
          ...actorFor(auth),
          action:
            statusChange === 'published'
              ? 'organization.published'
              : statusChange === 'draft'
                ? 'organization.unpublished'
                : 'organization.updated',
          before,
          after,
        });
        return presentMine(await loadOrganization(tx, id), member);
      });
      return ok(result);
    },
  },
});
