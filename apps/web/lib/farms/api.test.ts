import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FarmApiError,
  getFarm,
  getFarmGeojson,
  listFarmsForFarmer,
  summariseFarms,
  toFarm,
  toFeature,
  type FarmView,
} from './api';

const boundaryWithGeometry = {
  id: 'b-1',
  season: '2026-main',
  area_ha: 2.4,
  grade: 'good' as const,
  point_count: 7,
  mapped_by: 'o-3',
  mapped_at: '2026-07-23T00:00:00Z',
  is_current: true,
  gps_accuracy_m: 6,
  boundary: { type: 'Polygon' as const, coordinates: [[[31.5, 4.8], [31.6, 4.8], [31.6, 4.9], [31.5, 4.8]]] },
  centroid: { type: 'Point' as const, coordinates: [31.55, 4.83] as [number, number] },
};

// The same boundary as a lower role sees it: no coordinates, no GPS accuracy.
const boundaryHidden = {
  id: 'b-1',
  season: '2026-main',
  area_ha: 2.4,
  grade: 'good' as const,
  point_count: 7,
  mapped_by: 'o-3',
  mapped_at: '2026-07-23T00:00:00Z',
  is_current: true,
};

const farmRow = {
  id: 'e0000000-0000-4000-8000-000000000001',
  farmer_id: 'd0000000-0000-4000-8000-000000000001',
  payam_id: 'CE-JUB-JUB',
  county_id: 'CE-JUB',
  state_id: 'CE',
  season: '2026-main',
  created_by: 'o-3',
  created_at: '2026-07-23T00:00:00Z',
  updated_at: '2026-07-23T00:00:00Z',
  boundaries: [boundaryWithGeometry],
  crops: [
    { season: '2026-main', crop: 'sorghum' as const },
    { season: '2026-main', crop: 'maize' as const },
  ],
};

const feature = {
  type: 'Feature' as const,
  id: 'b-1',
  geometry: boundaryWithGeometry.boundary,
  properties: {
    farm_id: 'e0000000-0000-4000-8000-000000000001',
    boundary_id: 'b-1',
    farmer_id: 'd0000000-0000-4000-8000-000000000001',
    payam_id: 'CE-JUB-JUB',
    county_id: 'CE-JUB',
    state_id: 'CE',
    season: '2026-main',
    area_ha: 2.4,
    grade: 'good' as const,
    mapped_at: '2026-07-23T00:00:00Z',
  },
};

function mockFetch(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toFarm', () => {
  it('maps the farm and its boundary field for field', () => {
    const farm = toFarm(farmRow);
    expect(farm.id).toBe('e0000000-0000-4000-8000-000000000001');
    expect(farm.farmerId).toBe('d0000000-0000-4000-8000-000000000001');
    expect(farm.payamId).toBe('CE-JUB-JUB');
    expect(farm.boundaries).toHaveLength(1);
    const b = farm.boundaries[0]!;
    expect(b.areaHa).toBe(2.4);
    expect(b.grade).toBe('good');
    expect(b.pointCount).toBe(7);
    expect(b.gpsAccuracyM).toBe(6);
    expect(b.boundary).toEqual(boundaryWithGeometry.boundary);
    expect(b.centroid).toEqual(boundaryWithGeometry.centroid);
    expect(farm.crops.map((c) => c.crop)).toEqual(['sorghum', 'maize']);
  });

  it('turns absent geometry and GPS accuracy (hidden by role, C-7.8) into null', () => {
    const farm = toFarm({ ...farmRow, boundaries: [boundaryHidden] });
    const b = farm.boundaries[0]!;
    expect(b.gpsAccuracyM).toBeNull();
    expect(b.boundary).toBeNull();
    expect(b.centroid).toBeNull();
    // The grade, area and point count are for everyone and survive.
    expect(b.grade).toBe('good');
    expect(b.areaHa).toBe(2.4);
    expect(b.pointCount).toBe(7);
  });
});

describe('summariseFarms', () => {
  it('counts farms, sums the latest-season area and gathers unique crops', () => {
    const farms: FarmView[] = [
      toFarm(farmRow),
      toFarm({
        ...farmRow,
        id: 'e0000000-0000-4000-8000-000000000002',
        boundaries: [
          { ...boundaryWithGeometry, id: 'b-2', season: '2025-second', area_ha: 9 },
          { ...boundaryWithGeometry, id: 'b-3', season: '2026-main', area_ha: 1.5 },
        ],
        crops: [{ season: '2026-main', crop: 'sorghum' as const }],
      }),
    ];
    const s = summariseFarms(farms);
    expect(s.farmCount).toBe(2);
    // 2.4 (farm one) + 1.5 (farm two, latest season) — the 9 ha 2025 plot is not summed.
    expect(s.totalAreaHa).toBe(3.9);
    expect([...s.crops].sort()).toEqual(['maize', 'sorghum']);
  });
});

describe('listFarmsForFarmer', () => {
  it('reads the envelope data array and maps it', async () => {
    mockFetch(200, { data: [farmRow] });
    const farms = await listFarmsForFarmer('d0000000-0000-4000-8000-000000000001');
    expect(farms).toHaveLength(1);
    expect(farms[0]!.payamId).toBe('CE-JUB-JUB');
    const url = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toBe('/api/farmers/d0000000-0000-4000-8000-000000000001/farms');
  });
});

describe('getFarmGeojson', () => {
  it('maps features and reads the page cursor', async () => {
    mockFetch(200, { data: [feature], page: { cursor: 'next', hasMore: true } });
    const result = await getFarmGeojson({ payam: 'CE-JUB-JUB' });
    expect(result.features).toHaveLength(1);
    expect(result.features[0]!.areaHa).toBe(2.4);
    expect(result.features[0]!.payamId).toBe('CE-JUB-JUB');
    expect(result.features[0]!.geometry).toEqual(feature.geometry);
    expect(result.cursor).toBe('next');
    expect(result.hasMore).toBe(true);
    const url = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('/api/farms/geojson?');
    expect(url).toContain('payam=CE-JUB-JUB');
  });
});

describe('toFeature', () => {
  it('flattens the GeoJSON feature properties into the view type', () => {
    const f = toFeature(feature);
    expect(f.farmId).toBe('e0000000-0000-4000-8000-000000000001');
    expect(f.boundaryId).toBe('b-1');
    expect(f.grade).toBe('good');
    expect(f.geometry.type).toBe('Polygon');
  });
});

describe('error handling', () => {
  it('throws a FarmApiError carrying the code and rule', async () => {
    mockFetch(403, { error: { code: 'forbidden', message: 'No', rule: 'geometry_hidden' } });
    await expect(getFarm('e0000000-0000-4000-8000-000000000001')).rejects.toMatchObject({
      name: 'FarmApiError',
      status: 403,
      code: 'forbidden',
      rule: 'geometry_hidden',
    });
    expect(FarmApiError).toBeDefined();
  });

  it('falls back to a generic message when the body carries no error', async () => {
    mockFetch(500, {});
    await expect(getFarm('x')).rejects.toMatchObject({
      status: 500,
      code: 'unknown',
    });
  });
});
