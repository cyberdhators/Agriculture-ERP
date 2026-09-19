import { ACCURACY_FLAGS, type AccuracyFlag } from '@agri-erp/shared';

import type { FarmFeature, MapFilterParams } from './api';

/**
 * THE ADMINISTRATOR'S VIEW OF RECORDED FIELD GEOMETRY.
 *
 * Two rules govern everything here, and both are about not improving on what
 * the field actually recorded.
 *
 * 1. NO INVENTED GPS QUALITY. `grade` is the backend's own column — the
 *    ACCURACY_FLAGS enum, `good` / `poor` / `unusable`, computed server-side
 *    when the boundary was walked. This module passes it through and adds no
 *    tier of its own: no "Excellent", no "Fair", no comparison of a metre
 *    reading against a threshold invented on the client. An administrator
 *    deciding whether to trust a boundary must see what the system judged,
 *    not what a stylesheet felt like saying.
 *
 * 2. ABSENT IS NOT ZERO. A withheld measurement is withheld. Zero metres is a
 *    perfect fix, and printing it for a reader who was simply not sent the
 *    figure is the most flattering possible lie about a field record.
 */

export const ACCURACY_GRADES: readonly AccuracyFlag[] = ACCURACY_FLAGS;

/** The backend's vocabulary, spelled for a reader. No tier is added. */
export const GRADE_LABELS: Record<AccuracyFlag, string> = {
  good: 'Good',
  poor: 'Poor',
  unusable: 'Unusable',
};

/**
 * What the grade means, in the system's own terms rather than a judgement.
 * Used as help text beside the label so "Poor" is not read as an insult to
 * the officer who walked it.
 */
export const GRADE_NOTES: Record<AccuracyFlag, string> = {
  good: 'The recorded GPS accuracy met the standard when the boundary was walked.',
  poor: 'The recorded GPS accuracy was below standard. The boundary is kept and usable.',
  unusable: 'The recorded accuracy was too low to rely on. Excluded from the map.',
};

/* ---- Coordinates ------------------------------------------------------ */

/** Six decimal places is about 0.1 m — beyond any field GPS, and enough. */
const COORD_DP = 6;

export function formatCoordinate(lon: number, lat: number): string {
  return `${lat.toFixed(COORD_DP)}, ${lon.toFixed(COORD_DP)}`;
}

/**
 * The centroid of a ring, for a reader who needs one point rather than a shape.
 *
 * Returns null for a ring that is absent or degenerate rather than a point at
 * 0°N 0°E — which is in the Atlantic, and which a map would cheerfully draw.
 */
export function centroidOf(
  ring: readonly number[][] | undefined,
): { lon: number; lat: number } | null {
  if (!ring || ring.length === 0) return null;
  // A closed ring repeats its first point last; averaging it twice skews the
  // result, so the repeat is dropped before the mean.
  const points =
    ring.length > 1 &&
    ring[0]![0] === ring[ring.length - 1]![0] &&
    ring[0]![1] === ring[ring.length - 1]![1]
      ? ring.slice(0, -1)
      : ring;
  if (points.length === 0) return null;
  let lon = 0;
  let lat = 0;
  for (const point of points) {
    lon += point[0] ?? 0;
    lat += point[1] ?? 0;
  }
  return { lon: lon / points.length, lat: lat / points.length };
}

/* ---- Rows ------------------------------------------------------------- */

export interface FarmMapRow {
  farmId: string;
  boundaryId: string;
  farmerId: string;
  payamId: string;
  countyId: string;
  stateId: string;
  season: string;
  areaHa: number;
  grade: AccuracyFlag;
  mappedAt: string;
  /** Null when the feature carried no usable ring. Never a point at the origin. */
  centroid: { lon: number; lat: number } | null;
  ring: number[][] | null;
}

export function toMapRow(feature: FarmFeature): FarmMapRow {
  const ring = feature.geometry?.coordinates?.[0] ?? null;
  const p = feature.properties;
  return {
    farmId: p.farm_id,
    boundaryId: p.boundary_id,
    farmerId: p.farmer_id,
    payamId: p.payam_id,
    countyId: p.county_id,
    stateId: p.state_id,
    season: p.season,
    areaHa: p.area_ha,
    grade: p.grade,
    mappedAt: p.mapped_at,
    centroid: centroidOf(ring ?? undefined),
    ring,
  };
}

/* ---- Filters ---------------------------------------------------------- */

export interface MapFilters {
  payam: string;
  season: string;
}

export const EMPTY_MAP_FILTERS: MapFilters = { payam: '', season: '' };

/**
 * The query the map route will be sent.
 *
 * Payam and season are the two filters the specification names and the two
 * `geojsonFilterSchema` accepts. Nothing else is sent: no crop, no officer, no
 * accuracy tier, no date — those are GIS habits, not this contract.
 */
export function toMapParams(filters: MapFilters, cursor?: string): MapFilterParams {
  const params: MapFilterParams = {};
  if (filters.payam) params.payam = filters.payam;
  if (filters.season) params.season = filters.season;
  if (cursor) params.cursor = cursor;
  return params;
}

export const hasMapFilters = (filters: MapFilters): boolean =>
  Boolean(filters.payam || filters.season);

/** The seasons present on the page in front of the reader, for the picker. */
export function seasonsOf(rows: readonly FarmMapRow[]): string[] {
  return [...new Set(rows.map((row) => row.season))].sort().reverse();
}

/**
 * The total area of the rows ON THIS PAGE, labelled as such by the caller.
 *
 * Deliberately not a national figure: the route pages by cursor and reports no
 * total, so summing every page would be a number nobody asked the database for.
 */
export const areaOnPage = (rows: readonly FarmMapRow[]): number =>
  rows.reduce((sum, row) => sum + row.areaHa, 0);
