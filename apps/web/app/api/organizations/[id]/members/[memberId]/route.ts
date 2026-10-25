import {
  BUYER_ROLE,
  FARMER_ROLE,
  ORGANIZATION_MESSAGES,
  membershipChangeIssue,
  permissionsFor,
  updateMemberSchema,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../../lib/api/errors';
import { checkId, invalidField } from '../../../../../../lib/api/market-posts';
import {
  actorFor,
  asMember,
  loadMembers,
  lockTeam,
  personOf,
  presentMember,
  requireMember,
} from '../../../../../../lib/api/organizations';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';

/**
 * PATCH /api/organizations/:id/members/:memberId -- an administrator changes
 * a member's preset (Contributor or Viewer) or their granular permissions
 * (2026-10-27). `team.manage`.
 *
 * Nobody is MADE an administrator here: that is an offer the person accepts
 * (POST /transfer). An administrator may be moved to Contributor or Viewer --
 * themselves included -- unless they are the last one
 * (organization_last_admin).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: updateMemberSchema,
    handler: async ({ auth, params, body }) => {
      const me = personOf(auth);
      const id = checkId(params.id);
      const memberId = checkId(params.memberId);
      const result = await audited(prisma, async (tx) => {
        await lockTeam(tx, id);
        await requireMember(tx, id, me, { permission: 'team.manage', open: true });
        const members = await loadMembers(tx, id);
        const target = members.find((m) => m.id === memberId && m.status === 'active');
        if (!target) throw notFound();

        const preset = body.preset ?? target.preset;
        if (preset === 'administrator') {
          // Only permissions were sent for an administrator, who holds them all.
          throw invalidField('permissions', ORGANIZATION_MESSAGES.permissionsNotForPreset);
        }
        const permissions = permissionsFor(
          preset,
          body.permissions ?? (body.preset !== undefined ? undefined : target.permissions),
        );
        if (!permissions) {
          throw invalidField('permissions', ORGANIZATION_MESSAGES.permissionsNotForPreset);
        }
        if (target.preset === 'administrator') {
          const issue = membershipChangeIssue({
            members: members.map(asMember),
            targetId: target.id,
            change: 'demote',
          });
          if (issue) throw unprocessable(issue);
        }
        await tx.$queryRawUnsafe(
          `UPDATE public.organization_member
              SET preset = $2, permissions = $3::text[], updated_at = now()
            WHERE id = $1::uuid`,
          target.id,
          preset,
          permissions,
        );
        await writeAudit(tx, {
          entityType: 'organization_member',
          entityId: target.id,
          ...actorFor(auth),
          action: 'organization_member.updated',
          before: { preset: target.preset, permissions: target.permissions },
          after: { preset, permissions, organization_id: id },
        });
        const updated = (await loadMembers(tx, id)).find((m) => m.id === target.id)!;
        return presentMember(updated, me);
      });
      return ok(result);
    },
  },
});
