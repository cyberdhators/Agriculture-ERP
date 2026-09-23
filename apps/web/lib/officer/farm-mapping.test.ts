import { describe, expect, it } from 'vitest';

import {
  createFarmSchema,
  CROPS,
  gradeAccuracy,
  MIN_BOUNDARY_VERTICES,
  SEASON_PATTERN,
} from '@agri-erp/shared';

import {
  addPoint,
  boundaryAccuracy,
  buildBoundary,
  buildCrops,
  buildFarm,
  canClose,
  distinctCount,
  FARM_CROPS,
  gradeOf,
  isSeason,
  looksSelfCrossing,
  mappingProblems,
  polygonFrom,
  previewAreaHa,
  ringFrom,
  seasonOptions,
  toggleCrop,
  undoLast,
  type WalkPoint,
} from './farm-mapping';

const IDS = {
  farmId: 'd4e5f6a7-b8c9-4012-8d3e-4f5a6b7c8d90',
  boundaryId: 'e5f6a7b8-c9d0-4123-8e4f-5a6b7c8d9e01',
};

/** A square plot near Juba, walked corner to corner. */
const p = (longitude: number, latitude: number, accuracy_m = 6): WalkPoint => ({
  longitude,
  latitude,
  accuracy_m,
});
const SQUARE: WalkPoint[] = [p(31.58, 4.85), p(31.581, 4.85), p(31.581, 4.851), p(31.58, 4.851)];

describe('the walked ring becomes what the route wants', () => {
  it('closes by repeating the first point, which is bookkeeping and not a corner', () => {
    const ring = ringFrom(SQUARE);
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    // The closing repeat is not a distinct vertex, exactly as the server counts.
    expect(distinctCount(SQUARE)).toBe(4);
  });

  it('does not double-close a ring the officer already closed', () => {
    const closed = [...SQUARE, p(31.58, 4.85)];
    expect(ringFrom(closed)).toHaveLength(5);
  });

  it('is a GeoJSON Polygon of exactly one ring, longitude first', () => {
    const polygon = polygonFrom(SQUARE);
    expect(polygon.type).toBe('Polygon');
    expect(polygon.coordinates).toHaveLength(1);
    expect(polygon.coordinates[0]![0]).toEqual([31.58, 4.85]);
  });

  it('needs the contract’s minimum of distinct corners before it can close', () => {
    expect(MIN_BOUNDARY_VERTICES).toBe(4);
    expect(canClose(SQUARE.slice(0, 3))).toBe(false);
    expect(canClose(SQUARE)).toBe(true);
  });

  it('standing still and pressing twice adds no corner', () => {
    const stuck = [...SQUARE.slice(0, 3), p(31.581, 4.85)];
    expect(distinctCount(stuck)).toBe(3);
    expect(canClose(stuck)).toBe(false);
  });

  it('undo removes the last point only', () => {
    expect(undoLast(SQUARE)).toHaveLength(3);
    expect(undoLast([])).toEqual([]);
  });

  it('adds points up to the contract’s ceiling and no further', () => {
    const many = Array.from({ length: 2000 }, (_, i) => p(31.58 + i * 1e-6, 4.85));
    expect(addPoint(many, p(31.9, 4.9))).toHaveLength(2000);
  });
});

describe('accuracy is the canonical grade, and the worst reading of the walk', () => {
  it('one boundary carries one accuracy: the loosest corner, not the average', () => {
    const mixed = [p(31.58, 4.85, 4), p(31.581, 4.85, 40), p(31.581, 4.851, 5), p(31.58, 4.851, 6)];
    expect(boundaryAccuracy(mixed)).toBe(40);
  });

  it('an unwalked boundary has NO accuracy — not zero, which would grade "good"', () => {
    expect(boundaryAccuracy([])).toBeNull();
  });

  it('grades come from the shared function, at its own thresholds', () => {
    expect(gradeOf(10)).toBe(gradeAccuracy(10));
    expect(gradeOf(10)).toBe('good');
    expect(gradeOf(30)).toBe('poor');
    expect(gradeOf(30.1)).toBe('unusable');
  });
});

describe('the season follows the contract’s shape', () => {
  it('every offered season matches the canonical pattern', () => {
    for (const season of seasonOptions(new Date('2026-09-21T00:00:00Z'))) {
      expect(season).toMatch(SEASON_PATTERN);
    }
  });

  it('offers this year and last, both names — and claims nothing about any being open', () => {
    expect(seasonOptions(new Date('2026-09-21T00:00:00Z'))).toEqual([
      '2026-main',
      '2026-second',
      '2025-main',
      '2025-second',
    ]);
  });

  it('refuses a season the pattern does not admit', () => {
    for (const bad of ['2026', 'main', '2026-dry', '26-main', '']) {
      expect(isSeason(bad), bad).toBe(false);
    }
    expect(mappingProblems(SQUARE, '2026-dry', IDS).some((x) => x.field === 'season')).toBe(true);
  });
});

describe('what is sent, and what is emphatically not', () => {
  it('is accepted by the same schema the route runs', () => {
    const body = buildFarm(SQUARE, '2026-main', IDS, null);
    expect(createFarmSchema.safeParse(body).success).toBe(true);
  });

  it('NEVER sends an area — the server computes it and there is no field for it', () => {
    const body = buildFarm(SQUARE, '2026-main', IDS, null) as Record<string, unknown>;
    for (const key of ['area_ha', 'area', 'centroid', 'point_count', 'accuracy_flag', 'grade']) {
      expect(key in body, `${key} was sent`).toBe(false);
    }
  });

  it('never sends the farmer, the officer or the place — all derived server-side', () => {
    const body = buildFarm(SQUARE, '2026-main', IDS, null) as Record<string, unknown>;
    for (const key of ['farmer_id', 'created_by', 'mapped_by', 'payam_id', 'state_id']) {
      expect(key in body, `${key} was sent`).toBe(false);
    }
  });

  it('carries client ids for farm and boundary, which make a retry idempotent (C-9.1)', () => {
    const body = buildFarm(SQUARE, '2026-main', IDS, null);
    expect(body.id).toBe(IDS.farmId);
    expect(body.boundary_id).toBe(IDS.boundaryId);
  });

  it('an unknown capture moment is left OUT rather than sent as null', () => {
    const body = buildFarm(SQUARE, '2026-main', IDS, null) as Record<string, unknown>;
    expect('captured_at' in body).toBe(false);
    const stamped = buildFarm(SQUARE, '2026-main', IDS, '2026-09-21T09:00:00.000Z');
    expect(stamped.captured_at).toBe('2026-09-21T09:00:00.000Z');
  });

  it('a re-map sends the boundary alone — no farm, no farmer, no area', () => {
    const body = buildBoundary(SQUARE, '2026-second', IDS.boundaryId) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['boundary', 'gps_accuracy_m', 'id', 'season']);
  });
});

describe('the area shown while walking is a preview, not the record', () => {
  it('estimates a square plot in hectares, near the true value', () => {
    // ~111m x ~111m at this latitude, so a little over one hectare.
    const area = previewAreaHa(SQUARE)!;
    expect(area).toBeGreaterThan(1);
    expect(area).toBeLessThan(1.5);
  });

  it('has no estimate before there is a ring', () => {
    expect(previewAreaHa([])).toBeNull();
    expect(previewAreaHa(SQUARE.slice(0, 2))).toBeNull();
  });

  it('is never part of the request', () => {
    const body = buildFarm(SQUARE, '2026-main', IDS, null) as Record<string, unknown>;
    expect(Object.values(body)).not.toContain(previewAreaHa(SQUARE));
  });
});

describe('self-crossing is warned about, never refused here', () => {
  it('a plain square does not look self-crossing', () => {
    expect(looksSelfCrossing(SQUARE)).toBe(false);
  });

  it('a bow-tie does', () => {
    const bowtie = [p(31.58, 4.85), p(31.581, 4.851), p(31.581, 4.85), p(31.58, 4.851)];
    expect(looksSelfCrossing(bowtie)).toBe(true);
  });

  it('does not block the save — PostGIS is the authority on simplicity', () => {
    const bowtie = [p(31.58, 4.85), p(31.581, 4.851), p(31.581, 4.85), p(31.58, 4.851)];
    expect(mappingProblems(bowtie, '2026-main', IDS)).toEqual([]);
  });
});

describe('the walk is refused before it is sent when it obviously cannot succeed', () => {
  it('an unwalked boundary is named as the thing to do', () => {
    const problems = mappingProblems([], '2026-main', IDS);
    expect(problems.some((x) => x.field === 'boundary')).toBe(true);
  });

  it('three corners are too few, in the contract’s own terms', () => {
    const problems = mappingProblems(SQUARE.slice(0, 3), '2026-main', IDS);
    expect(problems.some((x) => x.field === 'boundary')).toBe(true);
  });

  it('a complete walk has nothing wrong with it', () => {
    expect(mappingProblems(SQUARE, '2026-main', IDS)).toEqual([]);
  });
});

describe('crops use the canonical list', () => {
  it('is the shared array itself, not a second copy', () => {
    expect(FARM_CROPS).toBe(CROPS);
    expect(FARM_CROPS).toHaveLength(5);
  });

  it('toggles without duplicating', () => {
    expect(toggleCrop(['maize'], 'sorghum')).toEqual(['maize', 'sorghum']);
    expect(toggleCrop(['maize', 'sorghum'], 'maize')).toEqual(['sorghum']);
  });

  it('is validated by the shared schema, season and all', () => {
    expect(buildCrops('2026-main', ['maize', 'cowpea'])).toEqual({
      season: '2026-main',
      crops: ['maize', 'cowpea'],
    });
    expect(() => buildCrops('2026-main', ['maize', 'maize'] as never)).toThrow();
    expect(() => buildCrops('2026-dry', ['maize'])).toThrow();
  });

  it('an empty list is a real instruction — the route REPLACES the season', () => {
    expect(buildCrops('2026-main', [])).toEqual({ season: '2026-main', crops: [] });
  });
});

describe('an unread walk can never be recorded as a perfect fix', () => {
  it('gradeAccuracy(0) IS "good", which is why zero was the wrong default', () => {
    // The defect this guards: `boundaryAccuracy(points) ?? 0` turned a walk
    // with no readings into a boundary measured to the nearest zero metres and
    // graded good -- as evidence about somebody's land.
    expect(gradeAccuracy(0)).toBe('good');
  });

  it('building a farm from no corners throws instead of sending zero', () => {
    expect(() => buildFarm([], '2026-main', IDS, null)).toThrow(
      /cannot be built before any corner has been read/i,
    );
  });

  it('building a boundary from no corners throws too', () => {
    expect(() => buildBoundary([], '2026-main', IDS.boundaryId)).toThrow(
      /cannot be built before any corner has been read/i,
    );
  });

  it('a real walk still carries its own worst reading', () => {
    expect(buildFarm(SQUARE, '2026-main', IDS, null).gps_accuracy_m).toBe(6);
  });

  it('and the screen refuses an empty walk long before either builder runs', () => {
    expect(mappingProblems([], '2026-main', IDS).length).toBeGreaterThan(0);
  });
});
