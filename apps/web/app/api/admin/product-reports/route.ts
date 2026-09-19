import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  decodeCursor,
  encodeCursor,
  productReportFilterSchema,
  toIso,
  zodErrorToApiError,
} from '@agri-erp/shared';

import { ApiFailure, invalidCursor } from '../../../../lib/api/errors';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/admin/product-reports — the moderation queue. ADMINISTRATOR ONLY.
 *
 * NOT the agricultural reporting module: that is `/api/reports`, deliverable
 * (t). This is marketplace moderation, and the two share no code or naming.
 *
 * THE REPORTER IS NOT RETURNED. `submission_digest` exists on the row so a
 * repeated submission about one listing can be refused; it identifies nobody,
 * is not reversible, and is never selected here. The description is not
 * returned either — it is free text a member of the public wrote, may name a
 * person, and belongs in the detail view an administrator opens deliberately
 * rather than in a list that renders forty of them at once.
 */
const REPORT_COLUMNS = `r.id, r.listing_id, r.reason::text AS reason, r.status::text AS status,
        r.created_at, r.updated_at, l.title AS listing_title, l.trading_name AS vendor_name,
        l.status::text AS listing_status`;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ request }) => {
      const parsed = productReportFilterSchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success) {
        const { body } = zodErrorToApiError(parsed.error);
        throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
      }
      const filter = parsed.data;

      let limit = DEFAULT_LIMIT;
      if (filter.limit !== undefined) {
        const n = Number(filter.limit);
        if (!Number.isInteger(n) || n < 1) throw invalidCursor();
        limit = Math.min(n, MAX_LIMIT);
      }

      const params: unknown[] = [];
      const where: string[] = [];
      if (filter.status) {
        params.push(filter.status);
        where.push(`r.status = $${params.length}::public.report_status`);
      }
      if (filter.reason) {
        params.push(filter.reason);
        where.push(`r.reason = $${params.length}::public.report_reason`);
      }
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(r.created_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<
        {
          id: string;
          listing_id: string;
          reason: string;
          status: string;
          created_at: Date;
          updated_at: Date;
          listing_title: string | null;
          vendor_name: string | null;
          listing_status: string | null;
        }[]
      >(
        `SELECT ${REPORT_COLUMNS}
         FROM public.product_report_active r
         LEFT JOIN public.produce_listing_active l ON l.id = r.listing_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ${limit + 1}`,
        ...params,
      );

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];

      return paged(
        page.map((row) => ({
          id: row.id,
          listing_id: row.listing_id,
          // Absent when the listing was removed: the report survives its
          // subject, and a removed listing keeps its id so the record still
          // means something.
          ...(row.listing_title === null ? {} : { listing_title: row.listing_title }),
          ...(row.vendor_name === null ? {} : { vendor_name: row.vendor_name }),
          reason: row.reason,
          status: row.status,
          created_at: toIso(row.created_at),
          updated_at: toIso(row.updated_at),
        })),
        {
          cursor:
            hasMore && last
              ? encodeCursor({ createdAt: toIso(last.created_at), id: last.id })
              : null,
          hasMore,
        },
      );
    },
  },
});
