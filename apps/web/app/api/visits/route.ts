import { defineRoutes } from '../../../lib/api/route';
import { pageVisits, parseVisitFilter } from '../../../lib/api/visits';
import { prisma } from '../../../lib/db';

/**
 * GET /api/visits — visits in the caller's scope, newest RECEIVED first
 * (C-8.5, C-8.9). Filters: farmer, officer, payam, from, to (on the server's
 * moment), limit, cursor. An officer sees their caseload's visits; a
 * supervisor or read-only user their state's.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ auth, request }) => pageVisits(prisma, auth, parseVisitFilter(request)),
  },
});
