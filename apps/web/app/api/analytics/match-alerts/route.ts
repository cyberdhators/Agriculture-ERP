import {
  matchAlertReportFilterSchema,
  resolveAnalyticsWindow,
  zodErrorToApiError,
} from '@agri-erp/shared';

import { analyticsStates } from '../../../../lib/analytics/scope';
import { ApiFailure, forbidden } from '../../../../lib/api/errors';
import { matchAlertReport } from '../../../../lib/api/match-alert-report';
import { requirePermissionCoverage } from '../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/analytics/match-alerts -- what match alerts led to (2026-11-03,
 * owner-approved): alerts sent (in the app, by SMS), opened, conversations
 * between the alerted person and the poster within 7 days, completed deals
 * between them within 30 days, with rates and a trend. Query: from, to
 * (Juba days; the last 30 when omitted, at most 366), state_id, commodity,
 * product (a word in the post's product) and source (buying_request_match,
 * listing_match, saved_search).
 *
 * Roles and scope exactly as GET /api/analytics/summary: admin, supervisor,
 * read_only, then `reports.view` somewhere, narrowed to the states it
 * reaches. Counts only: no person, post or message is named.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth, request }) => {
      const { coverage } = await requirePermissionCoverage(auth, 'reports.view');
      const parsed = matchAlertReportFilterSchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success) {
        const { body } = zodErrorToApiError(parsed.error);
        throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
      }
      const states = analyticsStates(auth.scope, coverage, parsed.data.state_id, forbidden);
      const { report } = await matchAlertReport(
        prisma,
        resolveAnalyticsWindow(parsed.data),
        states,
        parsed.data,
      );
      return ok(report, { 'cache-control': 'no-store' });
    },
  },
});
