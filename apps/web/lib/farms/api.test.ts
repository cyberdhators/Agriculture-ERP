import { afterEach, describe, expect, it, vi } from 'vitest';

import { FarmApiError, listFarmerFarms, toFarm, totalArea } from './api';

const ring: [number, number][] = [
  [31.58, 4.85],
  [31.59, 4.85],
  [31.59, 4.86],
  [31.58, 4.86],
  [31.58, 4.85],
];

const current = {
  id: 'b-2',
  season: '2026A',
  area_ha: 1.25,
  grade: 'good' as const,
  point_count: 5,
  mapped_by: 'o-1',
  mapped_at: '2026-08-01T09:00:00Z',
  is_current: true,
  gps_accuracy_m: 6,
  boundary: { type: 'Polygon' as const, coordinates: [ring] as [typeof ring] },
  centroid: { type: 'Point' as const, coordinates: [31.585, 4.855] as [number, number] },
};

const older = { ...current, id: 'b-1', is_current: false, area_ha: 1.1, season: '2025B' };

const row = {
  id: 'farm-1',
  farmer_id: 'f-1',
  payam_id: 'CE-JUB-REJ',
  county_id: 'CE-JUB',
  state_id: 'CE',
  season: '2026A',
  created_by: 'o-1',
  captured_at: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-08-01T09:00:00Z',
  boundaries: [older, current],
  crops: [
    { season: '2026A', crop: 'sorghum' as const },
    { season: '2026A', crop: 'maize' as const },
    { season: '2025B', crop: 'sorghum' as const },
  ],
};

function mockFetch(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

afterEach(() => vi.restoreAllMocks());

describe('toFarm', () => {
  it('flattens the CURRENT boundary onto the farm, not the first one', () => {
    const { farm } = toFarm(row);
    expect(farm.area_ha).toBe(1.25);
    expect(farm.season).toBe('2026A');
    expect(farm.boundary?.coordinates[0]).toHaveLength(5);
    expect(farm.centroid).toEqual({ lon: 31.585, lat: 4.855 });
    expect(farm.accuracy_flag).toBe('good');
    expect(farm.gps_accuracy_m).toBe(6);
  });

  it('dedupes crops across seasons', () => {
    expect(toFarm(row).crops).toEqual(['sorghum', 'maize']);
  });

  it('leaves withheld geometry ABSENT rather than defaulting it (C-7.8)', () => {
    // CHANGED, and the change is the point. This used to assert
    // `centroid === { lon: 0, lat: 0 }` — the origin, in the Atlantic — and a
    // GPS accuracy of 0, which reads as a perfect fix. Both were defaults
    // invented by the client for fields the route deliberately omits from
    // anyone but an administrator and the boundary's mapping officer. A
    // supervisor was shown a farm off the coast of Africa with flawless GPS.
    const hidden = { ...current };
    delete (hidden as Partial<typeof hidden>).boundary;
    delete (hidden as Partial<typeof hidden>).centroid;
    delete (hidden as Partial<typeof hidden>).gps_accuracy_m;
    const { farm } = toFarm({ ...row, boundaries: [hidden] });

    expect(farm.boundary).toBeNull();
    expect('centroid' in farm).toBe(false);
    expect(farm.centroid).toBeUndefined();
    expect('gps_accuracy_m' in farm).toBe(false);
    expect(farm.gps_accuracy_m).toBeUndefined();
    // The area was sent, so it survives: absent and zero are different, and so
    // are absent and present.
    expect(farm.area_ha).toBe(1.25);
  });

  it('never places an unmapped farm at 0°N 0°E', () => {
    // The origin is a real location a map will happily draw. A farm with no
    // boundary walked yet must not appear to be in the Gulf of Guinea.
    const { farm } = toFarm({ ...row, boundaries: [] });
    expect(farm.centroid).toBeUndefined();
    expect(JSON.stringify(farm)).not.toContain('"lon":0');
  });

  it('never reports a withheld GPS accuracy as ±0 m', () => {
    const hidden = { ...current };
    delete (hidden as Partial<typeof hidden>).gps_accuracy_m;
    delete (hidden as Partial<typeof hidden>).point_count;
    const { farm } = toFarm({ ...row, boundaries: [hidden] });
    expect(farm.gps_accuracy_m).not.toBe(0);
    expect(farm.point_count).not.toBe(0);
    expect(farm.gps_accuracy_m).toBeUndefined();
    expect(farm.point_count).toBeUndefined();
  });

  it('survives a farm with no boundary at all', () => {
    const { farm } = toFarm({ ...row, boundaries: [] });
    expect(farm.boundary).toBeNull();
    expect(farm.accuracy_flag).toBe('unusable');
    expect(farm.mapped_by).toBe('o-1');
    expect(farm.season).toBe('2026A');
  });
});

describe('listFarmerFarms', () => {
  it('reads the farmer route and maps every farm', async () => {
    mockFetch(200, { data: [row, { ...row, id: 'farm-2', boundaries: [] }] });
    const farms = await listFarmerFarms('f-1');
    expect(farms).toHaveLength(2);
    expect(totalArea(farms)).toBe(1.25);
  });

  it('turns a 404 (out of scope reads as not found) into a FarmApiError', async () => {
    mockFetch(404, { error: { code: 'not_found', message: 'No such farmer.' } });
    await expect(listFarmerFarms('nope')).rejects.toMatchObject({
      name: 'FarmApiError',
      status: 404,
      code: 'not_found',
    });
    expect(FarmApiError).toBeDefined();
  });
});
