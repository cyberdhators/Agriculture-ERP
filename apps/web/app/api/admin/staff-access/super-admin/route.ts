import { isSuperAdmin, superAdminGrantDecision, superAdminGrantSchema } from '@agri-erp/shared';

import { recordReauthFailed } from '../../../../../lib/api/access-log';
import { audited, writeAudit } from '../../../../../lib/api/audit';
import { type ApiFailure, conflict, forbidden, unprocessable } from '../../../../../lib/api/errors';
import { activeSuperAdminIds, permissionsOf } from '../../../../../lib/api/permissions';
import { reauthenticate } from '../../../../../lib/api/reauth';
import { created, defineRoutes } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import {
  loadActiveStaff,
  loadGrant,
  presentGrant,
  requireReauth,
} from '../../../../../lib/api/staff-access';
import { prisma } from '../../../../../lib/db';

const refusal = (
  reason: 'not_super_admin' | 'target_not_admin' | 'already_super_admin',
): ApiFailure =>
  reason === 'not_super_admin'
    ? forbidden()
    : reason === 'target_not_admin'
      ? unprocessable('super_admin_requires_admin')
      : conflict('already_super_admin');

/**
 * POST /api/admin/staff-access/super-admin -- SUPER ADMIN DELEGATION.
 * 2026-10-19, staff permissions lane.
 *
 * Roles: admin. Permission: `superadmin.grant` (held only by a Super Admin) --
 * or, while NO Super Admin exists, the BOOTSTRAP: an administrator may appoint
 * themselves, and only themselves (superAdminGrantDecision, packages/shared).
 *
 * Every appointment requires:
 *   1. an explicit confirmation (`confirm: true`, refused by the schema otherwise);
 *   2. RE-AUTHENTICATION: the granter's own password, verified on the server
 *      against their own account, with no change to their session and nothing
 *      logged (lib/api/reauth.ts). A verified TOTP factor, if the granter has
 *      one, adds a six-digit code. A wrong password is recorded in the access
 *      log as `reauth_failed`.
 *
 * The decision is taken twice: once before the password is checked (so a
 * caller who may not appoint is refused without being asked for one), and
 * again under a lock inside the transaction, so two administrators
 * bootstrapping at the same moment cannot both become the first.
 * Audited in the same transaction: superadmin.granted.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin'],
    bodySchema: superAdminGrantSchema,
    handler: async ({ auth, body, request }) => {
      requireWriter(auth);
      const target = await loadActiveStaff(prisma, body.user_id);
      const granterIsSuperAdmin = isSuperAdmin(await permissionsOf(auth));

      const decide = (ids: readonly string[]) =>
        superAdminGrantDecision({
          granterId: auth.principal.id,
          granterRole: auth.role,
          granterIsSuperAdmin,
          targetId: target.id,
          targetRole: target.role,
          activeSuperAdminIds: ids,
        });

      const first = decide(await activeSuperAdminIds(prisma));
      if (!first.allowed) throw refusal(first.reason);

      await requireReauth(
        await reauthenticate(auth.principal.authUserId, body.password, body.totp_code),
        () => recordReauthFailed(auth, request),
      );

      const grantId = await audited(prisma, async (tx) => {
        const decision = decide(await activeSuperAdminIds(tx, { lock: true }));
        if (!decision.allowed) throw refusal(decision.reason);

        const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.staff_permission_grant
             (user_id, preset, scope_kind, reason, granted_by)
           VALUES ($1::uuid, 'super_admin', 'platform', $2, $3::uuid)
           RETURNING id`,
          target.id,
          body.reason,
          auth.principal.id,
        );
        await writeAudit(tx, {
          entityType: 'staff_permission_grant',
          entityId: row!.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'superadmin.granted',
          before: null,
          // Never the password or the code: neither is in this object, and
          // `password` is on the audit denylist regardless.
          after: {
            user_id: target.id,
            preset: 'super_admin',
            scope: 'platform',
            reason: body.reason,
            bootstrap: decision.bootstrap,
            reauthenticated: true,
          },
        });
        return row!.id;
      });

      return created(presentGrant(await loadGrant(prisma, grantId)));
    },
  },
});
