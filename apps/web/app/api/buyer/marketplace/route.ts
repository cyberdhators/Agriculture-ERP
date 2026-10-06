import {
  BUYER_ROLE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  decodeCursor,
  marketplaceFilterSchema,
  zodErrorToApiError,
} from '@agri-erp/shared';

import {
  MARKET_BASE_WHERE,
  MARKET_COLUMNS,
  MARKET_FROM,
  marketCursor,
  presentMarketListing,
  requireBrowse,
  type MarketRow,
} from '../../../../lib/api/buyers';
import { ApiFailure, invalidCursor } from '../../../../lib/api/errors';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/buyer/marketplace -- what a buyer may discover. B13, C-14B.7 and
 * C-14B.9.
 *
 * SERVER-SIDE, ALL OF IT. Every filter is a WHERE clause and the page is cut
 * by the database at the standard cap: the browser never receives the
 * catalogue to filter for itself. Each filter is validated before the query;
 * one the route does not offer is a 400, not silently ignored.
 *
 * Every row leaves through `presentMarketListing`, the whitelist in
 * lib/api/buyers.ts -- no farmer id, phone, pickup note or storage path.
 *
 * The sort is the listing's last change, newest first, then id: a listing a
 * farmer has just restocked rises, which is what a buyer is looking for.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [BUYER_ROLE],
    handler: async ({ request, auth }) => {
      requireBrowse(auth);
      const parsed = marketplaceFilterSchema.safeParse(
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
      const where: string[] = [MARKET_BASE_WHERE];
      const add = (value: unknown): string => {
        params.push(value);
        return `$${params.length}`;
      };

      if (filter.q) {
        const like = `%${filter.q.replace(/[%_\\]/g, '\\$&')}%`;
        const p = add(like);
        where.push(
          `(pl.title ILIKE ${p} ESCAPE '\\' OR pl.product_name ILIKE ${p} ESCAPE '\\' OR pl.trading_name ILIKE ${p} ESCAPE '\\')`,
        );
      }
      if (filter.category)
        where.push(`pl.category = ${add(filter.category)}::public.listing_category`);
      if (filter.state_id) where.push(`pl.state_id = ${add(filter.state_id)}`);
      if (filter.county_id) where.push(`pm.county_id = ${add(filter.county_id)}`);
      if (filter.min_quantity !== undefined)
        where.push(`pl.quantity >= ${add(filter.min_quantity)}`);
      // "Available by" a date: it has started by then, and has not ended before it.
      if (filter.available_by) {
        const p = add(filter.available_by);
        where.push(
          `pl.available_from <= ${p}::date AND (pl.available_until IS NULL OR pl.available_until >= ${p}::date)`,
        );
      }
      if (filter.grade) where.push(`pl.quality_grade = ${add(filter.grade)}::public.listing_grade`);
      if (filter.min_price !== undefined) where.push(`pl.price_ssp >= ${add(filter.min_price)}`);
      if (filter.max_price !== undefined) where.push(`pl.price_ssp <= ${add(filter.max_price)}`);
      if (filter.supplier === 'verified') where.push(`f.verification_status = 'verified'`);

      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        where.push(
          `(pl.updated_at, pl.id) < (${add(cursor.createdAt)}::timestamptz, ${add(cursor.id)}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<MarketRow[]>(
        `SELECT ${MARKET_COLUMNS} ${MARKET_FROM}
          WHERE ${where.join(' AND ')}
          ORDER BY pl.updated_at DESC, pl.id DESC
          LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(page.map(presentMarketListing), {
        cursor: hasMore && last ? marketCursor(last) : null,
        hasMore,
      });
    },
  },
});
