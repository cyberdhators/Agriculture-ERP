import { submitProductReportSchema } from '@agri-erp/shared';

import { submitMarketReport } from '../../../../../../lib/api/market-posts';
import { created, defineRoutes } from '../../../../../../lib/api/route';

/**
 * POST /api/profiles/p/:publicId/reports -- a visitor reports a published
 * public profile (2026-10-23, public profiles v2). Public visibility is not an
 * endorsement, so anyone who sees a profile can flag it to the programme team.
 *
 * The market-report mechanism (POST /api/services/:id/reports), reused:
 * NOTHING ABOUT THE PERSON REPORTING IS STORED. The digest refuses a repeat of
 * the same report from the same source; the digest is NOT a rate limiter, and
 * there is no rate-limiting infrastructure in this application, so this
 * endpoint can be flooded -- the gap named in
 * docs/api/product-reports-contract.md. A profile that is not published, or
 * whose account is not live, is 404 like one that never existed.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: submitProductReportSchema,
    handler: async ({ body, params, request }) =>
      created(await submitMarketReport('profile', params.publicId, body, request)),
  },
});
