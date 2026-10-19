import { PERMISSION_KEYS, USER_ROLES, isSuperAdmin } from '@agri-erp/shared';

import { activeSuperAdminIds, permissionsOf } from '../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/admin/staff-access/me -- what the CALLER may do, so the screens can
 * offer only what will be accepted. It reports; it grants nothing. Every
 * route still decides for itself (requirePermission).
 *
 * Roles: admin, supervisor, read_only. No permission needed: it describes only
 * the caller's own permissions, plus whether any Super Admin exists -- which
 * the bootstrap offer depends on and which names nobody.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: USER_ROLES,
    handler: async ({ auth }) => {
      const permissions = await permissionsOf(auth);
      const superAdmins = await activeSuperAdminIds(prisma);
      const superAdmin = isSuperAdmin(permissions);
      return ok({
        user_id: auth.principal.id,
        role: auth.role,
        permissions: PERMISSION_KEYS.flatMap((key) => {
          const c = permissions.get(key);
          if (!c) return [];
          return [{ key, platform: c.platform, state_ids: c.platform ? [] : [...c.states].sort() }];
        }),
        is_super_admin: superAdmin,
        super_admin_exists: superAdmins.length > 0,
        // BOOTSTRAP (docs/DECISIONS.md, 2026-10-19): with no Super Admin at
        // all, an administrator may appoint themselves, re-authenticating.
        can_bootstrap_super_admin: superAdmins.length === 0 && auth.role === 'admin',
      });
    },
  },
});
