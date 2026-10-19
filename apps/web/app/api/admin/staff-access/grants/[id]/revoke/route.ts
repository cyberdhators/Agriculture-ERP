import { covers, revokeGrantSchema, toIso } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../../../lib/api/audit';
import { conflict, forbidden, notFound, unprocessable } from '../../../../../../../lib/api/errors';
import { permissionsOf } from '../../../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../../../lib/api/route';
import { requireWriter } from '../../../../../../../lib/api/scope';
import { homeScope, loadGrant, scopeOfGrant } from '../../../../../../../lib/api/staff-access';
import { prisma } from '../../../../../../../lib/db';

/**
 * POST /api/admin/staff-access/grants/[id]/revoke -- take a preset away, with
 * a recorded reason. The grant is kept, marked revoked: soft delete only.
 *
 * Roles: admin, supervisor. Permission: `staff.manage` covering the grant's
 * scope and the account holding it. A Super Admin grant is refused here (422)
 * and revoked only through delegation, which re-authenticates and protects
 * the last Super Admin. Audited in the same transaction: staff.permission_revoked.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: revokeGrantSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const grant = await loadGrant(prisma, params.id ?? '');
      if (grant.preset === 'super_admin') throw unprocessable('super_admin_through_delegation');
      if (grant.user_id === auth.principal.id) throw unprocessable('cannot_change_own_permissions');

      // The account may since have been removed; its state still decides who manages it.
      const [holder] = await prisma.$queryRawUnsafe<{ scope_state_id: string | null }[]>(
        `SELECT scope_state_id FROM public."user" WHERE id = $1::uuid`,
        grant.user_id,
      );
      if (!holder) throw notFound();

      const manage = (await permissionsOf(auth)).get('staff.manage');
      if (!covers(manage, scopeOfGrant(grant)) || !covers(manage, homeScope(holder))) {
        throw forbidden();
      }

      const revokedAt = await audited(prisma, async (tx) => {
        const [row] = await tx.$queryRawUnsafe<{ revoked_at: Date }[]>(
          `UPDATE public.staff_permission_grant
              SET revoked_at = now(), revoked_by = $2::uuid, revoke_reason = $3
            WHERE id = $1::uuid AND revoked_at IS NULL
            RETURNING revoked_at`,
          grant.id,
          auth.principal.id,
          body.reason,
        );
        if (!row) throw conflict('grant_not_active');
        await writeAudit(tx, {
          entityType: 'staff_permission_grant',
          entityId: grant.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'staff.permission_revoked',
          before: { revoked_at: null },
          after: {
            user_id: grant.user_id,
            preset: grant.preset,
            revoked_at: toIso(row.revoked_at),
            reason: body.reason,
          },
        });
        return row.revoked_at;
      });

      return ok({ id: grant.id, revoked_at: toIso(revokedAt) });
    },
  },
});
