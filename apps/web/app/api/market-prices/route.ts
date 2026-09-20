import { DEFAULT_LIMIT, MAX_LIMIT, decodeCursor, encodeCursor, z } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../lib/api/audit';
import { invalidCursor } from '../../../lib/api/errors';
import { created, defineRoutes, paged } from '../../../lib/api/route';
import { requireWriter, scopeCondition } from '../../../lib/api/scope';
import { prisma } from '../../../lib/db';

interface MarketPriceRow {
  id: string;
  commodity: string;
  market_name: string;
  price_ssp: string;
  unit: string;
  recorded_on: string;
  state_id: string;
  created_at: string;
}

const present = (row: MarketPriceRow) => ({
  id: row.id,
  commodity: row.commodity,
  market_name: row.market_name,
  price_ssp: Number(row.price_ssp),
  unit: row.unit,
  recorded_on: row.recorded_on,
  state_id: row.state_id,
  created_at: row.created_at,
});

const SELECT_COLUMNS = `id, commodity, market_name,
  price_ssp::text AS price_ssp, unit::text AS unit,
  to_char(recorded_on, 'YYYY-MM-DD') AS recorded_on,
  state_id, created_at::text AS created_at`;

const createSchema = z.object({
  commodity: z.string().min(1).max(120),
  market_name: z.string().min(1).max(120),
  price_ssp: z.number().min(0),
  unit: z.string().min(1),
  recorded_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  state_id: z.string().min(1),
});

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ request, auth }) => {
      const url = new URL(request.url);
      const rawLimit = url.searchParams.get('limit');
      const rawCursor = url.searchParams.get('cursor');

      let limit = DEFAULT_LIMIT;
      if (rawLimit !== null) {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1) throw invalidCursor();
        limit = Math.min(parsed, MAX_LIMIT);
      }

      const where: string[] = ['deleted_at IS NULL'];
      const params: unknown[] = [];

      const scope = scopeCondition(auth.scope, 'state_id', null, params.length + 1);
      if (scope.sql) {
        where.push(scope.sql);
        params.push(...scope.params);
      }

      const filterState = url.searchParams.get('state_id');
      if (filterState !== null) {
        params.push(filterState);
        where.push(`state_id = $${params.length}`);
      }

      if (rawCursor !== null) {
        const cursor = decodeCursor(rawCursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(`(recorded_on, id) < ($${params.length - 1}::date, $${params.length}::uuid)`);
      }

      const rows = await prisma.$queryRawUnsafe<MarketPriceRow[]>(
        `SELECT ${SELECT_COLUMNS}
         FROM public.market_price
         WHERE ${where.join(' AND ')}
         ORDER BY recorded_on DESC, id DESC
         LIMIT ${limit + 1}`,
        ...params,
      );

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];

      return paged(page.map(present), {
        cursor: hasMore && last ? encodeCursor({ createdAt: last.recorded_on, id: last.id }) : null,
        hasMore,
      });
    },
  },

  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: createSchema,
    handler: async ({ auth, body }) => {
      requireWriter(auth);

      const row = await audited(prisma, async (tx) => {
        const rows = await tx.$queryRawUnsafe<MarketPriceRow[]>(
          `INSERT INTO public.market_price
             (commodity, market_name, price_ssp, unit, recorded_on, state_id, created_by)
           VALUES ($1, $2, $3, $4::public.listing_unit, $5::date, $6, $7::uuid)
           RETURNING ${SELECT_COLUMNS}`,
          body.commodity,
          body.market_name,
          body.price_ssp,
          body.unit,
          body.recorded_on,
          body.state_id,
          auth.principal.id,
        );
        const inserted = rows[0]!;
        await writeAudit(tx, {
          entityType: 'market_price',
          entityId: inserted.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'market_price.created',
          after: {
            commodity: inserted.commodity,
            market_name: inserted.market_name,
            price_ssp: inserted.price_ssp,
            unit: inserted.unit,
            recorded_on: inserted.recorded_on,
            state_id: inserted.state_id,
          },
        });
        return inserted;
      });

      return created(present(row));
    },
  },
});
