import { gradeAccuracy, type AccuracyFlag, type Crop } from '@agri-erp/shared';

import type { FarmBoundaryRecord, FarmRecord } from '@/lib/farms/api';
import type { Farm, Ring } from '@/lib/fixtures/farmers';

/**
 * READING A FARM BACK, AS A MODEL.
 *
 * Everything here is arrangement of what `GET /api/farms/:id` and
 * `GET /api/farms/:id/boundaries` returned. Nothing is computed that the
 * server computes -- not the area, not the grade, not the point count -- and
 * nothing is defaulted.
 *
 * THE THREE STATES OF A SHAPE. This is the distinction the screen exists to
 * keep straight:
 *
 *   SHOWN     the boundary is there and its coordinates came with it.
 *   WITHHELD  the boundary EXISTS -- it has an area, a grade and a point
 *             count -- but C-7.8 gave the coordinates only to an administrator
 *             and the officer who walked it. Another officer, who took the
 *             farmer over, sees the farm and the figures and not the shape.
 *   NONE      there is no boundary for that season at all.
 *
 * Collapsing WITHHELD into NONE would tell an officer "no boundary walked"
 * about land that was carefully walked by somebody else. That is the exact
 * mistake the `Farm` type's own comment records being fixed once before.
 */
export type GeometryState = { kind: 'shown'; ring: Ring } | { kind: 'withheld' } | { kind: 'none' };

export function geometryOf(boundary: FarmBoundaryRecord | null | undefined): GeometryState {
  if (!boundary) return { kind: 'none' };
  const ring = boundary.boundary?.coordinates[0];
  // The KEY is absent when the reader is not entitled to it, so `in` is the
  // question -- not whether the value is falsy.
  if (!ring) return { kind: 'withheld' };
  return { kind: 'shown', ring };
}

/**
 * The canonical grade. The route already returns `grade` on every boundary, so
 * this is only for the rare row that carries the raw metres and nothing else;
 * it calls the shared function rather than inventing a second scale.
 */
export const gradeFor = (boundary: FarmBoundaryRecord): AccuracyFlag =>
  boundary.grade ??
  (boundary.gps_accuracy_m === undefined ? 'unusable' : gradeAccuracy(boundary.gps_accuracy_m));

export interface SeasonBlock {
  season: string;
  /** The boundary in force for this season, if the farm has one. */
  current: FarmBoundaryRecord | null;
  /** Earlier boundaries for the same season, newest first. Kept, never deleted. */
  superseded: FarmBoundaryRecord[];
  crops: Crop[];
}

/**
 * One block per season the farm has been mapped or planted for, newest first.
 *
 * The history route returns EVERY boundary, current ones included, so the
 * grouping is done from it alone; the farm's own `boundaries` array carries
 * only the current one per season and would hide the supersessions that are
 * the whole point of the history.
 *
 * A season that has crops but no boundary still gets a block: a declaration
 * without a walk is a real state of the record, and hiding it would lose it.
 */
export function seasonBlocks(
  record: Pick<FarmRecord, 'crops' | 'season'>,
  history: readonly FarmBoundaryRecord[],
): SeasonBlock[] {
  const seasons = new Set<string>([record.season]);
  for (const boundary of history) seasons.add(boundary.season);
  for (const crop of record.crops) seasons.add(crop.season);

  return [...seasons]
    .sort((a, b) => b.localeCompare(a))
    .map((season) => {
      const forSeason = history.filter((b) => b.season === season);
      return {
        season,
        current: forSeason.find((b) => b.is_current) ?? null,
        superseded: forSeason
          .filter((b) => !b.is_current)
          .sort((a, b) => b.mapped_at.localeCompare(a.mapped_at)),
        crops: record.crops.filter((c) => c.season === season).map((c) => c.crop),
      };
    });
}

/**
 * A `Farm`-shaped object for the existing `Boundary` SVG, built from one
 * boundary row.
 *
 * ONLY EVER CALLED FOR A SHOWN RING. `Boundary` renders "No boundary walked"
 * when it gets none, which is true for NONE and false for WITHHELD -- so the
 * caller decides which of the three states it is and this is used for one of
 * them. The optional figures are copied only when the route sent them.
 */
export function boundaryAsFarm(
  record: Pick<FarmRecord, 'id' | 'farmer_id'>,
  boundary: FarmBoundaryRecord,
  ring: Ring,
): Farm {
  return {
    id: record.id,
    farmer_id: record.farmer_id,
    boundary: { type: 'Polygon', coordinates: [ring] },
    ...(boundary.centroid
      ? {
          centroid: {
            lon: boundary.centroid.coordinates[0],
            lat: boundary.centroid.coordinates[1],
          },
        }
      : {}),
    ...(boundary.area_ha === undefined ? {} : { area_ha: boundary.area_ha }),
    ...(boundary.point_count === undefined ? {} : { point_count: boundary.point_count }),
    ...(boundary.gps_accuracy_m === undefined ? {} : { gps_accuracy_m: boundary.gps_accuracy_m }),
    accuracy_flag: gradeFor(boundary),
    mapped_by: boundary.mapped_by,
    mapped_at: boundary.mapped_at,
    season: boundary.season,
  } as Farm;
}

/** Has this farm been mapped at all, in any season? */
export const everMapped = (history: readonly FarmBoundaryRecord[]): boolean => history.length > 0;
