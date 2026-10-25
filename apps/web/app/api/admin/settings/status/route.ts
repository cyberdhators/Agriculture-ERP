import { requirePermission } from '../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { integrationStatus, staffMfaStatus } from '../../../../../lib/api/settings';

/**
 * GET /api/admin/settings/status (2026-10-25, settings phase 1). Security and
 * operations, READ-ONLY. ADMINISTRATOR ONLY, then `settings.manage`.
 *
 * NEVER A SECRET. Each integration is reported by whether each environment
 * variable NAME it reads is set -- a boolean -- and nothing of any value: no
 * length, no prefix, no last characters. Staff MFA is a count of staff with a
 * verified authenticator app, or "not tracked" if Supabase Auth's table
 * cannot be read here. Writes nothing.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth }) => {
      await requirePermission(auth, 'settings.manage');
      return ok({
        integrations: integrationStatus(),
        staff_mfa: await staffMfaStatus(),
      });
    },
  },
});
