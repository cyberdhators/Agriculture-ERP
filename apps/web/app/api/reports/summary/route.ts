import { reportFilterSchema, zodErrorToApiError } from '@agri-erp/shared';
import { ApiFailure } from '../../../../lib/api/errors';
import { summaryReport } from '../../../../lib/api/reporting';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/reports/summary — the dashboard's figures (C-10), within the
 * caller's scope: an officer their caseload, a supervisor or read-only user
 * their state, an administrator all (C-10.10). Filters: cutoff, from, to,
 * season, state, county, payam — the same set an export takes, so the two
 * agree (C-10.9). No farmer is named in it (C-10.11).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ auth, request }) => {
      const parsed = reportFilterSchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success) {
        const { body } = zodErrorToApiError(parsed.error);
        throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
      }
      const { summary } = await summaryReport(prisma, auth, parsed.data);
      return ok(summary);
    },
  },
});
