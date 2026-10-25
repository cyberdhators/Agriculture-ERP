import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../../../lib/api/errors';
import { checkId } from '../../../../../../../lib/api/market-posts';
import {
  INVITATION_SELECT,
  actorFor,
  personOf,
  presentInvitation,
  requireMember,
  type InvitationRow,
} from '../../../../../../../lib/api/organizations';
import { defineRoutes, ok } from '../../../../../../../lib/api/route';
import { prisma } from '../../../../../../../lib/db';

/**
 * POST /api/organizations/:id/invitations/:invitationId/cancel -- withdraw an
 * invitation or a handover offer that is still pending (2026-10-27).
 * `team.manage`. The row stays, as cancelled; its link stops working.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params }) => {
      const me = personOf(auth);
      const id = checkId(params.id);
      const invitationId = checkId(params.invitationId);
      const result = await audited(prisma, async (tx) => {
        await requireMember(tx, id, me, { permission: 'team.manage' });
        const [row] = await tx.$queryRawUnsafe<{ id: string; kind: string; status: string }[]>(
          `SELECT id, kind, status FROM public.organization_invitation
            WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE`,
          invitationId,
          id,
        );
        if (!row) throw notFound();
        if (row.status !== 'pending') throw unprocessable('organization_invitation_not_pending');
        await tx.$queryRawUnsafe(
          `UPDATE public.organization_invitation
              SET status = 'cancelled', responded_by = $2::uuid, responded_at = now(),
                  updated_at = now()
            WHERE id = $1::uuid`,
          row.id,
          me,
        );
        await writeAudit(tx, {
          entityType: 'organization_invitation',
          entityId: row.id,
          ...actorFor(auth),
          action:
            row.kind === 'transfer'
              ? 'organization_transfer.cancelled'
              : 'organization_invitation.cancelled',
          before: { status: 'pending' },
          after: { status: 'cancelled', organization_id: id },
        });
        const [stored] = await tx.$queryRawUnsafe<InvitationRow[]>(
          `${INVITATION_SELECT} WHERE i.id = $1::uuid`,
          row.id,
        );
        return presentInvitation(stored!, new Date(), true);
      });
      return ok(result);
    },
  },
});
