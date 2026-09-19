import { ACCURACY_FLAGS, geojsonFilterSchema } from '@agri-erp/shared';
import { describe, expect, it } from 'vitest';

import type { FarmFeature } from './api';
import {
  ACCURACY_GRADES,
  EMPTY_MAP_FILTERS,
  GRADE_LABELS,
  GRADE_NOTES,
  areaOnPage,
  centroidOf,
  formatCoordinate,
  hasMapFilters,
  seasonsOf,
  toMapParams,
  toMapRow,
} from './map-view';

const SQUARE = [
  [31.6, 4.85],
  [31.602, 4.85],
  [31.602, 4.852],
  [31.6, 4.852],
  [31.6, 4.85],
];

const feature = (patch: Partial<FarmFeature> = {}): FarmFeature =>
  ({
    type: 'Feature',
    id: 'b-1',
    geometry: { type: 'Polygon', coordinates: [SQUARE] },
    properties: {
      farm_id: 'fm-1',
      boundary_id: 'b-1',
      farmer_id: 'f-1',
      payam_id: 'CE-JUB-MUN',
      county_id: 'CE-JUB',
      state_id: 'CE',
      season: '2026-main',
      area_ha: 4.2,
      grade: 'good',
      mapped_at: '2026-09-01T00:00:00.000Z',
    },
    ...patch,
  }) as FarmFeature;

describe('GPS quality is the backend’s judgement, never ours', () => {
  it('uses exactly the grades the shared enum defines', () => {
    expect([...ACCURACY_GRADES]).toEqual([...ACCURACY_FLAGS]);
    expect([...ACCURACY_GRADES]).toEqual(['good', 'poor', 'unusable']);
  });

  it('invents no extra tier', () => {
    const labels = Object.values(GRADE_LABELS).map((l) => l.toLowerCase());
    for (const invented of ['excellent', 'fair', 'very good', 'acceptable', 'high', 'low']) {
      expect(labels, `invented a "${invented}" grade`).not.toContain(invented);
    }
    expect(Object.keys(GRADE_LABELS)).toHaveLength(3);
  });

  it('explains each grade without turning it into a verdict on the officer', () => {
    for (const grade of ACCURACY_GRADES) {
      expect(GRADE_NOTES[grade].length).toBeGreaterThan(0);
    }
    expect(GRADE_NOTES.poor).toMatch(/kept and usable/i);
  });
});

describe('coordinates', () => {
  it('prints latitude then longitude at field precision', () => {
    expect(formatCoordinate(31.6, 4.85)).toBe('4.850000, 31.600000');
  });

  it('averages a closed ring without counting the repeated point twice', () => {
    const centre = centroidOf(SQUARE)!;
    expect(centre.lon).toBeCloseTo(31.601, 6);
    expect(centre.lat).toBeCloseTo(4.851, 6);
  });

  it('returns null rather than a point in the Atlantic when there is no ring', () => {
    // 0°N 0°E is a real place a map will happily draw. Absent must stay absent.
    expect(centroidOf(undefined)).toBeNull();
    expect(centroidOf([])).toBeNull();
  });
});

describe('a map feature becomes a row without gaining anything', () => {
  it('carries through the properties the route sent', () => {
    const row = toMapRow(feature());
    expect(row.farmId).toBe('fm-1');
    expect(row.season).toBe('2026-main');
    expect(row.areaHa).toBe(4.2);
    expect(row.grade).toBe('good');
    expect(row.centroid).not.toBeNull();
  });

  it('keeps a geometry-less feature centroid-less instead of inventing one', () => {
    const row = toMapRow(feature({ geometry: null }));
    expect(row.ring).toBeNull();
    expect(row.centroid).toBeNull();
  });

  it('adds no field the route did not send', () => {
    const row = toMapRow(feature()) as unknown as Record<string, unknown>;
    for (const invented of ['quality', 'score', 'rating', 'accuracyLabel', 'gpsScore']) {
      expect(row[invented], `invented ${invented}`).toBeUndefined();
    }
  });
});

describe('the map sends only the two filters the route accepts', () => {
  it('sends nothing when nothing is chosen', () => {
    expect(toMapParams(EMPTY_MAP_FILTERS)).toEqual({});
  });

  it('builds a query the shared schema accepts', () => {
    const params = toMapParams({ payam: 'CE-JUB-MUN', season: '2026-main' }, 'cur');
    const asStrings = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]));
    expect(geojsonFilterSchema.safeParse(asStrings).success).toBe(true);
  });

  it('sends no filter the geojson route does not define', () => {
    const params = toMapParams({ payam: 'CE-JUB-MUN', season: '2026-main' }) as Record<
      string,
      unknown
    >;
    for (const invented of ['crop', 'officer', 'grade', 'accuracy', 'state', 'county', 'from']) {
      expect(params[invented], `sent an unsupported ${invented} filter`).toBeUndefined();
    }
  });

  it('knows whether the view is narrowed', () => {
    expect(hasMapFilters(EMPTY_MAP_FILTERS)).toBe(false);
    expect(hasMapFilters({ payam: 'CE-JUB-MUN', season: '' })).toBe(true);
  });
});

describe('page-scoped figures are page-scoped', () => {
  it('sums the area of the rows in hand and nothing else', () => {
    const rows = [toMapRow(feature()), toMapRow(feature())];
    expect(areaOnPage(rows)).toBeCloseTo(8.4, 6);
    // The caller labels this "on this page"; no national total exists to sum.
    expect(areaOnPage([])).toBe(0);
  });

  it('offers the seasons actually present, newest first', () => {
    const rows = [
      toMapRow(feature({ properties: { ...feature().properties, season: '2025-main' } })),
      toMapRow(feature()),
    ];
    expect(seasonsOf(rows)).toEqual(['2026-main', '2025-main']);
  });
});
