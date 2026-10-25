import { type MfaResetInput, mfaResetSchema } from '@agri-erp/shared';

import { recordReauthFailed } from '../../../../../../../lib/api/access-log';
import { audited, writeAudit } from '../../../../../../../lib/api/audit';
import { authUnavailable, unprocessable } from '../../../../../../../lib/api/errors';
import { requirePermission } from '../../../../../../../lib/api/permissions';
import { reauthenticate } from '../../../../../../../lib/api/reauth';
import { defineRoutes, ok } from '../../../../../../../lib/api/route';
import { requireWriter } from '../../../../../../../lib/api/scope';
import { loadActiveStaff, requireReauth } from '../../../../../../../lib/api/staff-access';
import { prisma } from '../../../../../../../lib/db';
import { deleteAllFactors, verifiedFactorIds } from '../../../../../../../lib/supabase/admin';

/**
 * POST /api/admin/staff-access/users/:id/mfa-reset { reason, password,
 * totp_code?, confirm } -- remove another staff member's authenticator so
 * they can set up a new one: a lost or replaced phone (2026-10-28,
 * lane-security; the infographic's "Manage MFA: require or reset").
 *
 * SUPER ADMIN ONLY (`superadmin.grant`): the specification fences "security
 * changes" off from ordinary administration. Explicit confirmation and
 * re-authentication with the caller's own password (and code), exactly as a
 * Super Admin appointment. Never on your own account: a person who has lost
 * their phone asks another Super Admin, so one stolen password cannot both
 * remove the second step and pass it.
 *
 * Removing a verified factor signs the account out everywhere (Supabase,
 * DOCUMENTED). Audited `staff.mfa_reset` with the reason and the number of
 * factors removed. If the removal fails part-way, nothing is recorded and the
 * caller is told to try again (503).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin'],
    bodySchema: mfaResetSchema,
    handler: async ({ auth, body: raw, params, request }) => {
      const body = raw as MfaResetInput;
      requireWriter(auth);
      await requirePermission(auth, 'superadmin.grant');

      const target = await loadActiveStaff(prisma, params.id ?? '');
      if (target.id === auth.principal.id) throw unprocessable('mfa_reset_own');

      let before: string[];
      try {
        before = await verifiedFactorIds(target.auth_user_id);
      } catch {
        throw authUnavailable();
      }
      if (before.length === 0) throw unprocessable('mfa_not_enrolled');

      await requireReauth(
        await reauthenticate(auth.principal.authUserId, body.password, body.totp_code),
        () => recordReauthFailed(auth, request),
      );

      let removed: number;
      try {
        removed = await deleteAllFactors(target.auth_user_id);
      } catch {
        throw authUnavailable();
      }

      await audited(prisma, async (tx) => {
        await writeAudit(tx, {
          entityType: 'user',
          entityId: target.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'staff.mfa_reset',
          before: { mfa_enrolled: true },
          after: {
            mfa_enrolled: false,
            factors_removed: removed,
            reason: body.reason,
            reauthenticated: true,
          },
        });
      });

      return ok({ id: target.id, factors_removed: removed });
    },
  },
});
