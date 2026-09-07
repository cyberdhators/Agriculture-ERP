import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  decodeCursor,
  encodeCursor,
  geojsonFilterSchema,
  toIso,
  zodErrorToApiError,
} from '@agri-erp/shared';
import { ApiFailure, invalidCursor } from '../../../../lib/api/errors';
import { FARM_FROM, farmScopeClause } from '../../../../lib/api/farms';
import { BOUNDARY_COLUMNS, type BoundaryRow } from '../../../../lib/api/geometry';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/farms/geojson — supervisor and administrator, scoped, filterable by
 * payam and season, cursor-paginated at the standard cap. Current boundaries
 * only, unusable excluded, soft-deleted farms excluded (C-7.4, C-7.9). The
 * map is the one place a supervisor sees coordinates: it is the purpose of
 * the route, and it is the state's map, not a person's record.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor'],
    handler: async ({ request, auth }) => {
      const url = new URL(request.url);
      const parsed = geojsonFilterSchema.safeParse(Object.fromEntries(url.searchParams));
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
      const p: unknown[] = [];
      const where = [`b.is_current`, `b.accuracy_flag <> 'unusable'`, ...farmScopeClause(auth, p)];
      if (filter.payam) {
        p.push(filter.payam);
        where.push(`f.payam_id = $${p.length}`);
      }
      if (filter.season) {
        p.push(filter.season);
        where.push(`b.season = $${p.length}`);
      }
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        p.push(cursor.createdAt, cursor.id);
        where.push(`(f.created_at, f.id) < ($${p.length - 1}::timestamptz, $${p.length}::uuid)`);
      }
      const rows = await prisma.$queryRawUnsafe<
        (BoundaryRow & {
          farmer_id: string;
          payam_id: string;
          county_id: string;
          state_id: string;
          farm_created_at: Date;
        })[]
      >(
        `SELECT ${BOUNDARY_COLUMNS}, f.farmer_id, f.payam_id, f.county_id, f.state_id, f.created_at AS farm_created_at ${FARM_FROM}
         JOIN public.farm_boundary b ON b.farm_id = f.id
         WHERE ${where.join(' AND ')}
         ORDER BY f.created_at DESC, f.id DESC, b.season DESC
         LIMIT ${limit + 1}`,
        ...p,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(
        page.map((r) => ({
          type: 'Feature',
          // One feature per current boundary: a farm appears once per season.
          id: r.id,
          geometry: JSON.parse(r.boundary_geojson) as unknown,
          properties: {
            farm_id: r.farm_id,
            boundary_id: r.id,
            farmer_id: r.farmer_id,
            payam_id: r.payam_id,
            county_id: r.county_id,
            state_id: r.state_id,
            season: r.season,
            area_ha: Number(r.area_ha),
            grade: r.accuracy_flag,
            mapped_at: toIso(r.mapped_at),
          },
        })),
        {
          cursor:
            hasMore && last
              ? encodeCursor({ createdAt: toIso(last.farm_created_at), id: last.farm_id })
              : null,
          hasMore,
          type: 'FeatureCollection',
        },
      );
    },
  },
});
