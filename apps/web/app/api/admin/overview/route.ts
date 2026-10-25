import {
  adminOverviewFilterSchema,
  holdsPermission,
  resolveAnalyticsWindow,
  zodErrorToApiError,
} from '@agri-erp/shared';

import { analyticsStates } from '../../../../lib/analytics/scope';
import { adminOverview } from '../../../../lib/api/admin-overview';
import { ApiFailure, forbidden } from '../../../../lib/api/errors';
import { requirePermissionCoverage } from '../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/admin/overview -- the administration overview (2026-10-28): people,
 * accounts and organisational profiles counted separately, active users,
 * live listings, services and buying requests, open cases by queue, two daily
 * trends and system alerts. Query: from, to (YYYY-MM-DD; the last 30 days when
 * omitted), state_id, actor (an activity from the account profile).
 *
 * Roles: admin, supervisor, read_only (requireRole). Permission: `reports.view`
 * somewhere, and scoped exactly like GET /api/analytics/summary: a supervisor
 * or read-only user sees their state only, narrowed again to the states the
 * permission reaches. Figures that carry no state (support messages, appeals,
 * adviser applications, recorded failures) are national only and are served
 * as "not located" to anyone limited to states. Integrations are named only to
 * a caller who holds `settings.manage`, as the settings status route requires.
 * Counts only: no person is named, no message text is read. Writes nothing.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth, request }) => {
      const { coverage, permissions } = await requirePermissionCoverage(auth, 'reports.view');
      const parsed = adminOverviewFilterSchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success) {
        const { body } = zodErrorToApiError(parsed.error);
        throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
      }
      const filter = parsed.data;
      const states = analyticsStates(auth.scope, coverage, filter.state_id, forbidden);
      const overview = await adminOverview(prisma, {
        window: resolveAnalyticsWindow(filter),
        filter,
        states,
        seesSettings: holdsPermission(permissions, 'settings.manage'),
      });
      return ok(overview, { 'cache-control': 'no-store' });
    },
  },
});
