import { submitProductReportSchema } from '@agri-erp/shared';

import { submitMarketReport } from '../../../../../lib/api/market-posts';
import { created, defineRoutes } from '../../../../../lib/api/route';

/**
 * POST /api/services/:id/reports -- a marketplace visitor reports a service
 * listing. LISTINGS LANE (2026-10-19).
 *
 * The product-report mechanism (POST /api/listings/:id/reports), reused.
 * NOTHING ABOUT THE PERSON IS STORED. The digest refuses a repeat of the same
 * report from the same source; it is NOT a rate limiter, and there is no
 * rate-limiting infrastructure in this application, so this endpoint can be
 * flooded -- the gap named in docs/api/product-reports-contract.md.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: submitProductReportSchema,
    handler: async ({ body, params, request }) =>
      created(await submitMarketReport('service_listing', params.id, body, request)),
  },
});
