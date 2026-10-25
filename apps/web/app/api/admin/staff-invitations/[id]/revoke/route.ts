import { PLATFORM } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../../lib/api/errors';
import { checkId } from '../../../../../../lib/api/market-posts';
import { requirePermission } from '../../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { requireWriter } from '../../../../../../lib/api/scope';
import {
  STAFF_INVITATION_SELECT,
  type StaffInvitationRow,
  presentStaffInvitation,
} from '../../../../../../lib/api/staff-invitations';
import { prisma } from '../../../../../../lib/db';

/**
 * POST /api/admin/staff-invitations/:id/revoke -- withdraw an invitation that
 * has not been used (2026-10-28). The link stops working at once. Holders of
 * `staff.manage` over the invitation's state (platform-wide for an
 * administrator invitation). Audited `staff.invitation_revoked`.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor'],
    handler: async ({ auth, params }) => {
      requireWriter(auth);
      const id = checkId(params.id);
      const [current] = await prisma.$queryRawUnsafe<{ scope_state_id: string | null }[]>(
        `SELECT scope_state_id FROM public.staff_invitation WHERE id = $1::uuid`,
        id,
      );
      if (!current) throw notFound();
      await requirePermission(
        auth,
        'staff.manage',
        current.scope_state_id ? { kind: 'states', stateIds: [current.scope_state_id] } : PLATFORM,
      );

      const row = await audited(prisma, async (tx) => {
        const [updated] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `UPDATE public.staff_invitation
              SET revoked_at = now(), revoked_by = $2::uuid
            WHERE id = $1::uuid AND accepted_at IS NULL AND revoked_at IS NULL
            RETURNING id`,
          id,
          auth.principal.id,
        );
        if (!updated) throw unprocessable('staff_invitation_not_pending');
        await writeAudit(tx, {
          entityType: 'staff_invitation',
          entityId: id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'staff.invitation_revoked',
          before: { status: 'pending' },
          after: { status: 'revoked' },
        });
        const [fresh] = await tx.$queryRawUnsafe<StaffInvitationRow[]>(
          `${STAFF_INVITATION_SELECT} WHERE i.id = $1::uuid`,
          id,
        );
        return fresh as StaffInvitationRow;
      });
      return ok(presentStaffInvitation(row));
    },
  },
});
