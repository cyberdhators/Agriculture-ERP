import { USER_ROLES, toIso } from '@agri-erp/shared';

import { requirePermissionCoverage } from '../../../../lib/api/permissions';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { type GrantRecord, presentGrant } from '../../../../lib/api/staff-access';
import { prisma } from '../../../../lib/db';

interface StaffRow {
  id: string;
  name: string;
  role: string;
  scope_state_id: string | null;
  last_seen_at: Date | null;
}

/** A staff list is small; this is a ceiling, not a page size anyone should reach. */
const STAFF_CEILING = 500;

/**
 * GET /api/admin/staff-access -- every active staff account with the presets
 * it holds and their scope. 2026-10-19, staff permissions lane.
 *
 * Roles: admin, supervisor, read_only (requireRole). Permission: `staff.manage`
 * somewhere. Held platform-wide, it lists everyone; held for some states, it
 * lists only the supervisors and read-only staff of those states --
 * administrators are national and are listed only to platform holders.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: USER_ROLES,
    handler: async ({ auth }) => {
      const { coverage } = await requirePermissionCoverage(auth, 'staff.manage');
      const states = coverage.platform ? null : [...coverage.states];

      const staff = await prisma.$queryRawUnsafe<StaffRow[]>(
        `SELECT u.id, u.name, u.role::text AS role, u.scope_state_id, a.last_seen_at
           FROM public.user_active u
           LEFT JOIN public.account_activity a
                  ON a.principal_kind = 'user' AND a.principal_id = u.id
          ${states ? 'WHERE u.scope_state_id = ANY($1::text[])' : ''}
          ORDER BY u.name, u.id
          LIMIT ${STAFF_CEILING}`,
        ...(states ? [states] : []),
      );

      const grants =
        staff.length === 0
          ? []
          : await prisma.$queryRawUnsafe<GrantRecord[]>(
              `SELECT g.id, g.user_id, g.preset, g.scope_kind, g.reason, g.granted_by,
                      g.granted_at, g.revoked_at,
                      COALESCE(array_agg(s.state_id ORDER BY s.state_id)
                               FILTER (WHERE s.state_id IS NOT NULL), '{}') AS state_ids
                 FROM public.staff_permission_grant g
                 LEFT JOIN public.staff_permission_grant_state s ON s.grant_id = g.id
                WHERE g.revoked_at IS NULL AND g.user_id = ANY($1::uuid[])
                GROUP BY g.id
                ORDER BY g.granted_at`,
              staff.map((s) => s.id),
            );

      const byUser = new Map<string, ReturnType<typeof presentGrant>[]>();
      for (const g of grants) {
        const list = byUser.get(g.user_id) ?? [];
        list.push(presentGrant(g));
        byUser.set(g.user_id, list);
      }

      return paged(
        staff.map((s) => ({
          id: s.id,
          name: s.name,
          role: s.role,
          state_id: s.scope_state_id,
          last_activity_at: s.last_seen_at ? toIso(s.last_seen_at) : null,
          // The legacy rule, made visible: an administrator holds every
          // permission except appointing a Super Admin, with no grant row.
          legacy_admin: s.role === 'admin',
          grants: byUser.get(s.id) ?? [],
        })),
        { cursor: null, hasMore: staff.length >= STAFF_CEILING },
      );
    },
  },
});
