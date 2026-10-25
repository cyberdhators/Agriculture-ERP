import {
  BUYER_ROLE,
  FARMER_ROLE,
  membershipChangeIssue,
  revokeMemberSchema,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../../../lib/api/errors';
import { checkId } from '../../../../../../../lib/api/market-posts';
import { notifyAccount } from '../../../../../../../lib/api/notify';
import {
  actorFor,
  asMember,
  loadMembers,
  lockTeam,
  personOf,
  presentMember,
  requireMember,
} from '../../../../../../../lib/api/organizations';
import { defineRoutes, ok } from '../../../../../../../lib/api/route';
import { prisma } from '../../../../../../../lib/db';

/**
 * POST /api/organizations/:id/members/:memberId/revoke -- an administrator
 * ends a member's access, with a reason (2026-10-27). `team.manage`.
 *
 * WHAT IT KEEPS. The membership row stays (status revoked, when, by whom, the
 * reason), so the organisation's history -- its posts, its conversations, the
 * audit of what that person did for it -- is untouched, and the person's own
 * account is not touched at all. Their very next request acting for the
 * organisation is refused (lib/api/organizations.ts actingAs). Any handover
 * offered to them is withdrawn. They are told in the app, in a fixed sentence.
 *
 * Ending your own access is "Leave" (organization_use_leave); the last
 * administrator cannot be removed (organization_last_admin).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: revokeMemberSchema,
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
        if (target.auth_user_id === me) throw unprocessable('organization_use_leave');
        const issue = membershipChangeIssue({
          members: members.map(asMember),
          targetId: target.id,
          change: 'revoke',
        });
        if (issue) throw unprocessable(issue);

        await tx.$queryRawUnsafe(
          `UPDATE public.organization_member
              SET status = 'revoked', ended_at = now(), ended_by = $2::uuid, end_reason = $3,
                  updated_at = now()
            WHERE id = $1::uuid`,
          target.id,
          me,
          body.reason,
        );
        await tx.$queryRawUnsafe(
          `UPDATE public.organization_invitation SET status = 'cancelled', updated_at = now()
            WHERE target_member_id = $1::uuid AND status = 'pending'`,
          target.id,
        );
        await writeAudit(tx, {
          entityType: 'organization_member',
          entityId: target.id,
          ...actorFor(auth),
          action: 'organization_member.revoked',
          before: { status: 'active', preset: target.preset },
          after: { status: 'revoked', reason: body.reason, organization_id: id },
        });
        await notifyAccount(
          tx,
          { authUserId: target.auth_user_id },
          'organization_access_ended',
          actorFor(auth),
        );
        const updated = (await loadMembers(tx, id)).find((m) => m.id === target.id)!;
        return presentMember(updated, me);
      });
      return ok(result);
    },
  },
});
