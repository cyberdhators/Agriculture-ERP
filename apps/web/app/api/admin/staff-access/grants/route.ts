import { covers, grantPresetSchema, scopeOfGrantInput } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { conflict, forbidden, unprocessable } from '../../../../../lib/api/errors';
import { permissionsOf } from '../../../../../lib/api/permissions';
import { created, defineRoutes } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import {
  homeScope,
  isUniqueViolation,
  loadActiveStaff,
  loadGrant,
  presentGrant,
  requireStatesExist,
} from '../../../../../lib/api/staff-access';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/admin/staff-access/grants -- give a staff account a preset, with a
 * recorded reason. 2026-10-19, staff permissions lane.
 *
 * Roles: admin, supervisor (read_only writes nothing, C-3.9). Permission:
 * `staff.manage` covering BOTH the scope of the new grant AND the account it
 * is given to -- a state Administrator manages their own state's staff,
 * within their own state, and nobody national.
 *
 * Never Super Admin: the schema refuses the preset, and Super Admin has its own
 * route that asks for the granter's password. No-one changes their own
 * permissions here. Audited in the same transaction: staff.permission_granted.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: grantPresetSchema,
    handler: async ({ auth, body }) => {
      requireWriter(auth);
      const scope = scopeOfGrantInput(body);
      const target = await loadActiveStaff(prisma, body.user_id);
      if (target.id === auth.principal.id) throw unprocessable('cannot_change_own_permissions');

      const permissions = await permissionsOf(auth);
      const manage = permissions.get('staff.manage');
      if (!covers(manage, scope) || !covers(manage, homeScope(target))) throw forbidden();

      if (scope.kind === 'states') await requireStatesExist(scope.stateIds);

      let grantId: string;
      try {
        grantId = await audited(prisma, async (tx) => {
          const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO public.staff_permission_grant
               (user_id, preset, scope_kind, reason, granted_by)
             VALUES ($1::uuid, $2, $3, $4, $5::uuid)
             RETURNING id`,
            target.id,
            body.preset,
            scope.kind,
            body.reason,
            auth.principal.id,
          );
          const id = row!.id;
          if (scope.kind === 'states') {
            for (const stateId of scope.stateIds) {
              await tx.$executeRawUnsafe(
                `INSERT INTO public.staff_permission_grant_state (grant_id, state_id)
                 VALUES ($1::uuid, $2)`,
                id,
                stateId,
              );
            }
          }
          await writeAudit(tx, {
            entityType: 'staff_permission_grant',
            entityId: id,
            actorType: auth.role,
            actorId: auth.principal.id,
            action: 'staff.permission_granted',
            before: null,
            after: {
              user_id: target.id,
              preset: body.preset,
              scope: scope.kind,
              state_ids: scope.kind === 'states' ? scope.stateIds : [],
              reason: body.reason,
            },
          });
          return id;
        });
      } catch (error) {
        // One active grant per (account, preset): the partial unique index.
        if (isUniqueViolation(error, 'staff_permission_grant_one_active_key')) {
          throw conflict('preset_already_held');
        }
        throw error;
      }

      return created(presentGrant(await loadGrant(prisma, grantId)));
    },
  },
});
