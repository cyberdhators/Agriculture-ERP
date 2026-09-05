import {
  type AccuracyFlag,
  type GeoJsonPolygon,
  MIN_BOUNDARY_VERTICES,
  gradeAccuracy,
} from '@agri-erp/shared';
import { Prisma } from '@prisma/client';
import { type AuditTx } from './audit';
import { conflict, unprocessable } from './errors';

/**
 * All spatial SQL lives here (C-7). No other file writes it.
 *
 * Order of judgement for a submitted ring (C-7.2), each with its own pinned
 * sentence: not closed — the officer did not return to the start; too few
 * points — they stopped walking early; crosses itself — they cut across the
 * plot. Closure and the count are judged here, before the database, because
 * the GeoJSON parser refuses an open ring with its own words. Simplicity and
 * validity are judged by PostGIS. Winding is normalised: whichever way the
 * officer walked, the stored ring is counter-clockwise and the area is
 * positive (ST_ForcePolygonCCW), which a test proves both ways.
 */
export interface BoundaryRow {
  id: string;
  farm_id: string;
  season: string;
  area_ha: string;
  point_count: number;
  gps_accuracy_m: string;
  accuracy_flag: AccuracyFlag;
  mapped_by: string;
  mapped_at: Date;
  is_current: boolean;
  boundary_geojson: string;
  centroid_geojson: string;
}

/** Selected from farm_boundary b. Geometry as GeoJSON text; the presenter decides who sees it. */
export const BOUNDARY_COLUMNS = `
  b.id, b.farm_id, b.season, b.area_ha::text AS area_ha, b.point_count,
  b.gps_accuracy_m::text AS gps_accuracy_m, b.accuracy_flag::text AS accuracy_flag,
  b.mapped_by, b.mapped_at, b.is_current,
  extensions.ST_AsGeoJSON(b.boundary) AS boundary_geojson,
  extensions.ST_AsGeoJSON(b.centroid) AS centroid_geojson`;

const samePoint = (a: readonly number[], b: readonly number[]): boolean =>
  a[0] === b[0] && a[1] === b[1];

/** Distinct vertices: the closing repeat is not counted. */
export function distinctVertices(polygon: GeoJsonPolygon): number {
  const ring = polygon.coordinates[0] ?? [];
  const seen = new Set(ring.map(([lng, lat]) => `${lng},${lat}`));
  return seen.size;
}

export function isClosed(polygon: GeoJsonPolygon): boolean {
  const ring = polygon.coordinates[0] ?? [];
  if (ring.length < 2) return false;
  return samePoint(ring[0] as number[], ring[ring.length - 1] as number[]);
}

/**
 * Inserts a boundary for a farm and season, superseding the current one if
 * any, in the caller's audited transaction. The partial unique index
 * (farm_id, season) WHERE is_current is the last word on "one current": two
 * concurrent supersedes cannot both end current.
 */
export async function insertBoundary(
  tx: AuditTx,
  input: {
    farmId: string;
    season: string;
    polygon: GeoJsonPolygon;
    gpsAccuracyM: number;
    mappedBy: string;
  },
): Promise<{ row: BoundaryRow; superseded: string | null }> {
  if (!isClosed(input.polygon)) throw unprocessable('boundary_not_closed');
  if (distinctVertices(input.polygon) < MIN_BOUNDARY_VERTICES) {
    throw unprocessable('boundary_too_few_points');
  }

  const geojson = JSON.stringify(input.polygon);
  const [judged] = await tx.$queryRawUnsafe<{ simple: boolean; valid: boolean }[]>(
    `SELECT extensions.ST_IsSimple(g) AS simple, extensions.ST_IsValid(g) AS valid
     FROM (SELECT extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON($1), 4326) AS g) t`,
    geojson,
  );
  if (!judged?.simple || !judged.valid) throw unprocessable('boundary_crosses_itself');

  const [previous] = await tx.$queryRawUnsafe<{ id: string }[]>(
    `UPDATE public.farm_boundary SET is_current = false
     WHERE farm_id = $1::uuid AND season = $2 AND is_current RETURNING id`,
    input.farmId,
    input.season,
  );

  const grade = gradeAccuracy(input.gpsAccuracyM);
  let inserted: BoundaryRow | undefined;
  try {
    [inserted] = await tx.$queryRawUnsafe<BoundaryRow[]>(
      `WITH g AS (
         SELECT extensions.ST_ForcePolygonCCW(
                  extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON($3), 4326)
                )::extensions.geography AS geog
       ),
       b AS (
         INSERT INTO public.farm_boundary
           (farm_id, season, boundary, centroid, area_ha, point_count, gps_accuracy_m, accuracy_flag, mapped_by, is_current)
         SELECT $1::uuid, $2, g.geog,
                extensions.ST_Centroid(g.geog),
                round((extensions.ST_Area(g.geog) / 10000)::numeric, 4),
                $4, $5, $6::public.accuracy_flag, $7::uuid, true
         FROM g
         RETURNING *
       )
       SELECT ${BOUNDARY_COLUMNS} FROM b`,
      input.farmId,
      input.season,
      geojson,
      distinctVertices(input.polygon),
      input.gpsAccuracyM,
      grade,
      input.mappedBy,
    );
  } catch (failure) {
    if (
      failure instanceof Prisma.PrismaClientKnownRequestError &&
      failure.code === 'P2010' &&
      String((failure.meta as { message?: unknown } | undefined)?.message ?? '').includes(
        'farm_boundary_one_current_per_season',
      )
    ) {
      throw conflict('boundary_recorded_concurrently');
    }
    throw failure;
  }
  if (!inserted) throw new Error('boundary insert returned no row');
  return { row: inserted, superseded: previous?.id ?? null };
}

/** Current boundaries of a farm, one per season, newest season first. */
export async function currentBoundaries(
  db: { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] },
  farmIds: readonly string[],
): Promise<BoundaryRow[]> {
  if (farmIds.length === 0) return [];
  return db.$queryRawUnsafe<BoundaryRow[]>(
    `SELECT ${BOUNDARY_COLUMNS} FROM public.farm_boundary b
     WHERE b.farm_id = ANY($1::uuid[]) AND b.is_current ORDER BY b.farm_id, b.season DESC`,
    farmIds,
  );
}

/** Every boundary of a farm, history included, newest first (C-7.5). */
export async function boundaryHistory(
  db: { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] },
  farmId: string,
): Promise<BoundaryRow[]> {
  return db.$queryRawUnsafe<BoundaryRow[]>(
    `SELECT ${BOUNDARY_COLUMNS} FROM public.farm_boundary b
     WHERE b.farm_id = $1::uuid ORDER BY b.season DESC, b.mapped_at DESC`,
    farmId,
  );
}
