import {
  analyticsFilterSchema,
  resolveAnalyticsWindow,
  zodErrorToApiError,
} from '@agri-erp/shared';

import { analyticsStates } from '../../../../lib/analytics/scope';
import { analyticsSummary } from '../../../../lib/api/analytics';
import { ApiFailure, forbidden } from '../../../../lib/api/errors';
import { requirePermissionCoverage } from '../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/analytics/summary -- marketplace and account figures for a window
 * of Juba days (2026-10-22). Query: from, to (YYYY-MM-DD; the last 30 days
 * when omitted, at most 366), state_id.
 *
 * Roles: admin, supervisor, read_only (requireRole). Permission: `reports.view`
 * somewhere (every administrator holds it; other staff through the Analyst or
 * Administrator preset). Scoped like the reports: a supervisor or read-only
 * user sees their state only, narrowed again to the states the permission
 * reaches. Counts only: no person is named, no message text is read.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth, request }) => {
      const { coverage } = await requirePermissionCoverage(auth, 'reports.view');
      const parsed = analyticsFilterSchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success) {
        const { body } = zodErrorToApiError(parsed.error);
        throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
      }
      const states = analyticsStates(auth.scope, coverage, parsed.data.state_id, forbidden);
      const { summary } = await analyticsSummary(
        prisma,
        resolveAnalyticsWindow(parsed.data),
        states,
        parsed.data.state_id ?? null,
      );
      return ok(summary, { 'cache-control': 'no-store' });
    },
  },
});
