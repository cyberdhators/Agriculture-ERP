import {
  createFarmSchema,
  declareCropsSchema,
  CROPS,
  FARM_LIMITS,
  gradeAccuracy,
  MIN_BOUNDARY_VERTICES,
  SEASON_NAMES,
  SEASON_PATTERN,
  type AccuracyFlag,
  type AddBoundary,
  type CreateFarm,
  type Crop,
  type DeclareCrops,
  type GeoJsonPolygon,
} from '@agri-erp/shared';

/**
 * WALKING A FARM BOUNDARY, AS A MODEL.
 *
 * Every rule is read off `packages/shared/src/farm.ts` and
 * `lib/api/geometry.ts` rather than decided again. Nothing here authorises
 * anything: the farmer comes from the URL, the officer from the session, and
 * the server re-checks both.
 *
 * WHAT THE SERVER DECIDES, AND THIS NEVER SENDS. The area, the centroid, the
 * point count and the accuracy grade are all computed by PostGIS on insert,
 * and the ring's winding is normalised there too -- so it does not matter
 * which way round the officer walked. This sends the ring, the accuracy in
 * metres and the season; it sends no area.
 *
 * THE ORDER OF REFUSAL is the geometry module's, each with its own sentence:
 * not closed, too few points, crosses itself. The first two are mirrored here
 * so the screen does not offer a save that is certain to fail after a walk;
 * self-crossing is only WARNED about, because PostGIS is the authority on
 * simplicity and a stricter guess here would block a legitimate plot.
 */

/** One reading, as `navigator.geolocation` gives it. Never stored anywhere. */
export interface WalkPoint {
  longitude: number;
  latitude: number;
  accuracy_m: number;
}

export const MAX_POINTS = FARM_LIMITS.maxVertices;

export const addPoint = (points: readonly WalkPoint[], point: WalkPoint): WalkPoint[] =>
  points.length >= MAX_POINTS ? [...points] : [...points, point];

export const undoLast = (points: readonly WalkPoint[]): WalkPoint[] => points.slice(0, -1);

/**
 * Distinct vertices, counted the way `distinctVertices` counts them: by
 * coordinate pair, so standing still and pressing twice adds nothing.
 */
export function distinctCount(points: readonly WalkPoint[]): number {
  return new Set(points.map((p) => `${p.longitude},${p.latitude}`)).size;
}

export const canClose = (points: readonly WalkPoint[]): boolean =>
  distinctCount(points) >= MIN_BOUNDARY_VERTICES;

/**
 * The ring the route wants: the walked points with the FIRST REPEATED at the
 * end, because `isClosed` compares the first and last pair exactly. The
 * officer walks back to where they started; the closing repeat is bookkeeping,
 * not another reading, and is not counted as a vertex.
 */
export function ringFrom(points: readonly WalkPoint[]): [number, number][] {
  if (points.length === 0) return [];
  const ring = points.map((p) => [p.longitude, p.latitude] as [number, number]);
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return ring;
}

export const polygonFrom = (points: readonly WalkPoint[]): GeoJsonPolygon =>
  ({ type: 'Polygon', coordinates: [ringFrom(points)] }) as GeoJsonPolygon;

/**
 * ONE ACCURACY FOR THE WHOLE BOUNDARY, AND IT IS THE WORST ONE.
 *
 * The contract stores a single `gps_accuracy_m` per boundary, not one per
 * point, so a walk of many readings has to become one number. The worst is the
 * honest choice: a ring is only as trustworthy as its loosest corner, and
 * averaging would let one 40-metre reading hide inside nine good ones and be
 * graded "good" (C-7.4).
 */
export function boundaryAccuracy(points: readonly WalkPoint[]): number | null {
  if (points.length === 0) return null;
  return Math.round(Math.max(...points.map((p) => p.accuracy_m)));
}

/** The canonical grade for a reading. Never a word of our own. */
export const gradeOf = (metres: number): AccuracyFlag => gradeAccuracy(metres);

/* ---- Season ------------------------------------------------------------ */

/**
 * SEASONS ARE A SHAPE, NOT A LIST. The contract is a pattern --
 * `YYYY-main` or `YYYY-second` -- and there is no table of seasons, no "open"
 * flag and nothing that says which is current. So this offers the years an
 * officer plausibly maps in and says nothing about any of them being open,
 * because the backend does not know that and neither do we.
 */
export const seasonsFor = (year: number): string[] => SEASON_NAMES.map((name) => `${year}-${name}`);

export function seasonOptions(now = new Date()): string[] {
  const year = now.getFullYear();
  return [...seasonsFor(year), ...seasonsFor(year - 1)];
}

export const isSeason = (value: string): boolean => SEASON_PATTERN.test(value.trim());

/* ---- Area, as a PREVIEW only ------------------------------------------- */

const EARTH_RADIUS_M = 6_371_008.8;

/**
 * An ESTIMATE of the enclosed area, in hectares, for the officer to sanity
 * check while still standing on the plot.
 *
 * THIS IS NOT THE FARM'S AREA. The stored figure is PostGIS's `ST_Area` on a
 * geography, computed on the spheroid at insert and rounded to four decimals;
 * this is the spherical-excess formula on a perfect sphere and will differ
 * slightly. It exists so a walk that enclosed a tenth of what it should can be
 * spotted before saving, and it is never sent: `createFarmSchema` has no area
 * field, so there is nothing for it to override.
 */
export function previewAreaHa(points: readonly WalkPoint[]): number | null {
  const ring = ringFrom(points);
  if (ring.length < 4) return null;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [lng1, lat1] = ring[i]!;
    const [lng2, lat2] = ring[i + 1]!;
    total += (rad(lng2) - rad(lng1)) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  const squareMetres = Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
  return Math.round((squareMetres / 10_000) * 10_000) / 10_000;
}

/* ---- Self-crossing: a warning, never a refusal -------------------------- */

const crosses = (
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  d: readonly [number, number],
): boolean => {
  const side = (p: readonly number[], q: readonly number[], r: readonly number[]) =>
    Math.sign((q[0]! - p[0]!) * (r[1]! - p[1]!) - (q[1]! - p[1]!) * (r[0]! - p[0]!));
  const d1 = side(a, b, c);
  const d2 = side(a, b, d);
  const d3 = side(c, d, a);
  const d4 = side(c, d, b);
  return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
};

/**
 * Does the walked ring obviously cross itself? PostGIS decides for real --
 * `ST_IsSimple` and `ST_IsValid`, answering `boundary_crosses_itself`. This is
 * only a heads-up while the officer is still on the plot, so it tests strictly
 * (proper crossings only) and never blocks a save.
 */
export function looksSelfCrossing(points: readonly WalkPoint[]): boolean {
  const ring = ringFrom(points);
  if (ring.length < 5) return false;
  for (let i = 0; i < ring.length - 1; i += 1) {
    for (let j = i + 2; j < ring.length - 1; j += 1) {
      if (i === 0 && j === ring.length - 2) continue;
      if (crosses(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!)) return true;
    }
  }
  return false;
}

/* ---- What gets sent ---------------------------------------------------- */

/**
 * THE ACCURACY OF A WALK THAT HAS NO READINGS IS NOT ZERO.
 *
 * These builders used to write `boundaryAccuracy(points) ?? 0`, and zero is
 * not a harmless placeholder here: `gradeAccuracy(0)` is GOOD. An empty walk
 * would have been recorded as a boundary measured to the nearest zero metres,
 * graded good, and stored as evidence about somebody's land.
 *
 * `mappingProblems` refuses an empty walk before either builder is called, so
 * this cannot happen today. It throws rather than defaulting so that it cannot
 * START happening quietly if a future caller forgets that guard -- a loud
 * failure in a path that is already unreachable costs nothing, and a silent
 * "good" costs the truth of a land record.
 */
function requireAccuracy(points: readonly WalkPoint[]): number {
  const accuracy = boundaryAccuracy(points);
  if (accuracy === null) {
    throw new Error('A boundary cannot be built before any corner has been read.');
  }
  return accuracy;
}

export interface MappingIds {
  farmId: string;
  boundaryId: string;
}

export function buildFarm(
  points: readonly WalkPoint[],
  season: string,
  ids: MappingIds,
  capturedAt: string | null,
): CreateFarm {
  const body: Record<string, unknown> = {
    id: ids.farmId,
    boundary_id: ids.boundaryId,
    season,
    boundary: polygonFrom(points),
    gps_accuracy_m: requireAccuracy(points),
  };
  // Optional AND nullable on the contract: an unknown capture moment is left
  // out, not sent as null (C-5.8).
  if (capturedAt !== null) body.captured_at = capturedAt;
  return body as CreateFarm;
}

export const buildBoundary = (
  points: readonly WalkPoint[],
  season: string,
  boundaryId: string,
): AddBoundary => ({
  id: boundaryId,
  season,
  boundary: polygonFrom(points),
  gps_accuracy_m: requireAccuracy(points),
});

export interface Problem {
  field: string;
  message: string;
}

/**
 * What still stops this walk being saved, in the server's own words where the
 * server has words for it.
 *
 * The two geometry rules mirrored here are the ones judged BEFORE the database
 * in `insertBoundary`, so their sentences are its sentences. Everything else is
 * handed to `createFarmSchema`, which is the same schema the route runs.
 */
export function mappingProblems(
  points: readonly WalkPoint[],
  season: string,
  ids: MappingIds,
): Problem[] {
  const problems: Problem[] = [];
  if (!isSeason(season)) {
    problems.push({
      field: 'season',
      message: 'Give the season as a year and a name: 2026-main or 2026-second.',
    });
  }
  if (points.length === 0) {
    problems.push({ field: 'boundary', message: 'Walk the boundary and mark its corners.' });
    return problems;
  }
  if (!canClose(points)) {
    problems.push({
      field: 'boundary',
      message: `Mark at least ${MIN_BOUNDARY_VERTICES} different corners before closing the boundary.`,
    });
  }
  if (problems.length > 0) return problems;

  const parsed = createFarmSchema.safeParse(buildFarm(points, season, ids, null));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push({ field: String(issue.path[0] ?? 'form'), message: issue.message });
    }
  }
  return problems;
}

/* ---- Crops ------------------------------------------------------------- */

/** The five, from the canonical list. Never re-listed. */
export const FARM_CROPS = CROPS;

export const toggleCrop = (crops: readonly Crop[], crop: Crop): Crop[] =>
  crops.includes(crop) ? crops.filter((c) => c !== crop) : [...crops, crop];

/**
 * A crop declaration REPLACES the season's list, so an empty list is a
 * meaningful instruction -- "nothing is planted here this season" -- and not
 * the same as never having declared.
 */
export function buildCrops(season: string, crops: readonly Crop[]): DeclareCrops {
  return declareCropsSchema.parse({ season, crops: [...crops] });
}
