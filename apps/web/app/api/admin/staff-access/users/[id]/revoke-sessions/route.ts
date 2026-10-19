import { revokeSessionsSchema } from '@agri-erp/shared';

import { writeAuditOutcome } from '../../../../../../../lib/api/audit';
import { authUnavailable } from '../../../../../../../lib/api/errors';
import { requirePermission } from '../../../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../../../lib/api/route';
import { requireWriter } from '../../../../../../../lib/api/scope';
import { loadActiveStaff } from '../../../../../../../lib/api/staff-access';
import { prisma } from '../../../../../../../lib/db';
import { revokeAllSessions } from '../../../../../../../lib/supabase/admin';

/**
 * POST /api/admin/staff-access/users/[id]/revoke-sessions -- sign a staff
 * member out everywhere, at once. A Super Admin action. 2026-10-19.
 *
 * Roles: admin. Permission: `superadmin.grant`. Body: a reason and an explicit
 * confirmation. The account is NOT disabled: they can sign in again with their
 * password. To end access for good, remove the account (C-3.6).
 *
 * The call to Supabase is HTTP with no transaction, so the audit row records
 * the OUTCOME after it returns -- staff.sessions_revoked on success,
 * staff.sessions_revoke_failed on failure -- as auth.disabled does.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin'],
    bodySchema: revokeSessionsSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      await requirePermission(auth, 'superadmin.grant');
      const target = await loadActiveStaff(prisma, params.id ?? '');

      const outcome = {
        entityType: 'user',
        entityId: target.id,
        actorType: auth.role,
        actorId: auth.principal.id,
        after: { reason: body.reason },
      } as const;
      try {
        await revokeAllSessions(target.auth_user_id);
      } catch {
        await writeAuditOutcome({ ...outcome, action: 'staff.sessions_revoke_failed' }).catch(
          () => undefined,
        );
        throw authUnavailable();
      }
      await writeAuditOutcome({ ...outcome, action: 'staff.sessions_revoked' });
      return ok({ user_id: target.id, sessions_revoked: true });
    },
  },
});
