import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  decodeCursor,
  encodeCursor,
  farmFilterSchema,
  toIso,
  zodErrorToApiError,
} from '@agri-erp/shared';
import { ApiFailure, invalidCursor } from '../../../lib/api/errors';
import {
  FARM_COLUMNS,
  FARM_FROM,
  type FarmRow,
  cropsOf,
  farmScopeClause,
  presentFarm,
} from '../../../lib/api/farms';
import { currentBoundaries } from '../../../lib/api/geometry';
import { defineRoutes, paged } from '../../../lib/api/route';
import { prisma } from '../../../lib/db';

/**
 * GET /api/farms — farms in the caller's scope, newest first, paged (C-9.9).
 * Filters: farmer, payam, updated_since (the server's moment of last change),
 * limit, cursor. Geometry per C-7.8. The download side of sync for farms; the
 * per-farmer list remains at /api/farmers/:id/farms.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ auth, request }) => {
      const parsed = farmFilterSchema.safeParse(
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
      const where: string[] = farmScopeClause(auth, params);
      const add = (sql: (i: number) => string, value: unknown) => {
        params.push(value);
        where.push(sql(params.length));
      };
      if (filter.farmer) add((i) => `f.farmer_id = $${i}::uuid`, filter.farmer);
      if (filter.payam) add((i) => `f.payam_id = $${i}`, filter.payam);
      if (filter.updated_since)
        add((i) => `f.updated_at > $${i}::timestamptz`, filter.updated_since);
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(f.created_at, f.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }
      const rows = await prisma.$queryRawUnsafe<FarmRow[]>(
        `SELECT ${FARM_COLUMNS} ${FARM_FROM}
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY f.created_at DESC, f.id DESC
         LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const ids = page.map((f) => f.id);
      const [bounds, crops] = await Promise.all([
        currentBoundaries(prisma, ids),
        cropsOf(prisma, ids),
      ]);
      return paged(
        page.map((f) => presentFarm(f, bounds, crops, auth)),
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
