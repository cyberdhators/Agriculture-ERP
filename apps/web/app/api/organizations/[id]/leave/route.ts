import { BUYER_ROLE, FARMER_ROLE, membershipChangeIssue } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { unprocessable } from '../../../../../lib/api/errors';
import { checkId } from '../../../../../lib/api/market-posts';
import {
  actingCookie,
  actorFor,
  asMember,
  loadMembers,
  lockTeam,
  personOf,
  requestedOrganization,
  requireMember,
} from '../../../../../lib/api/organizations';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/organizations/:id/leave -- the caller ends their own access
 * (2026-10-27). Their membership row stays as history (status left); their
 * own account is untouched. The last administrator cannot leave: they hand
 * over administration (with the other person's acceptance) or close the
 * organisation (organization_last_admin).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params, request }) => {
      const me = personOf(auth);
      const id = checkId(params.id);
      await audited(prisma, async (tx) => {
        await lockTeam(tx, id);
        const { member } = await requireMember(tx, id, me);
        const members = await loadMembers(tx, id);
        const issue = membershipChangeIssue({
          members: members.map(asMember),
          targetId: member.id,
          change: 'leave',
        });
        if (issue) throw unprocessable(issue);
        await tx.$queryRawUnsafe(
          `UPDATE public.organization_member
              SET status = 'left', ended_at = now(), ended_by = $2::uuid,
                  end_reason = 'Left the organisation.', updated_at = now()
            WHERE id = $1::uuid`,
          member.id,
          me,
        );
        await tx.$queryRawUnsafe(
          `UPDATE public.organization_invitation SET status = 'cancelled', updated_at = now()
            WHERE (target_member_id = $1::uuid OR invited_by_member_id = $1::uuid)
              AND kind = 'transfer' AND status = 'pending'`,
          member.id,
        );
        await writeAudit(tx, {
          entityType: 'organization_member',
          entityId: member.id,
          ...actorFor(auth),
          action: 'organization_member.left',
          before: { status: 'active', preset: member.preset },
          after: { status: 'left', organization_id: id },
        });
      });
      // Leaving the organisation you are acting for puts you back as yourself.
      const headers =
        requestedOrganization(request) === id ? { 'set-cookie': actingCookie(null) } : undefined;
      return ok({ left: true }, headers);
    },
  },
});
