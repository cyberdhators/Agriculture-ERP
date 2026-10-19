import { mayLoseSuperAdmin, superAdminRevokeSchema, toIso } from '@agri-erp/shared';

import { recordReauthFailed } from '../../../../../../../lib/api/access-log';
import { audited, writeAudit } from '../../../../../../../lib/api/audit';
import { conflict, notFound, unprocessable } from '../../../../../../../lib/api/errors';
import { activeSuperAdminIds, requirePermission } from '../../../../../../../lib/api/permissions';
import { reauthenticate } from '../../../../../../../lib/api/reauth';
import { defineRoutes, ok } from '../../../../../../../lib/api/route';
import { requireWriter } from '../../../../../../../lib/api/scope';
import { loadGrant, requireReauth } from '../../../../../../../lib/api/staff-access';
import { prisma } from '../../../../../../../lib/db';

/**
 * POST /api/admin/staff-access/super-admin/[id]/revoke -- end a Super Admin
 * appointment. [id] is the grant. 2026-10-19, staff permissions lane.
 *
 * Roles: admin. Permission: `superadmin.grant`. Explicit confirmation and
 * re-authentication, as for the appointment. THE LAST ACTIVE SUPER ADMIN IS
 * PROTECTED: refused with 422 unless another active Super Admin remains,
 * decided under the same lock appointments take. Audited: superadmin.revoked.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin'],
    bodySchema: superAdminRevokeSchema,
    handler: async ({ auth, body, params, request }) => {
      requireWriter(auth);
      await requirePermission(auth, 'superadmin.grant');

      const grant = await loadGrant(prisma, params.id ?? '');
      if (grant.preset !== 'super_admin') throw notFound();
      if (grant.revoked_at) throw conflict('grant_not_active');
      if (!mayLoseSuperAdmin(await activeSuperAdminIds(prisma), grant.user_id)) {
        throw unprocessable('last_super_admin');
      }

      await requireReauth(
        await reauthenticate(auth.principal.authUserId, body.password, body.totp_code),
        () => recordReauthFailed(auth, request),
      );

      const revokedAt = await audited(prisma, async (tx) => {
        const ids = await activeSuperAdminIds(tx, { lock: true });
        if (!mayLoseSuperAdmin(ids, grant.user_id)) throw unprocessable('last_super_admin');

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
          action: 'superadmin.revoked',
          before: { revoked_at: null },
          after: {
            user_id: grant.user_id,
            preset: 'super_admin',
            revoked_at: toIso(row.revoked_at),
            reason: body.reason,
            reauthenticated: true,
          },
        });
        return row.revoked_at;
      });

      return ok({ id: grant.id, revoked_at: toIso(revokedAt) });
    },
  },
});
