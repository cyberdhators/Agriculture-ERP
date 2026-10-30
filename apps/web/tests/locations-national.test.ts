import { describe, expect, it, vi } from 'vitest';

/**
 * THE NATIONAL LOCATION LIST AND THE WEATHER BESIDE IT (2026-10-30).
 *
 * docs/data/locations.csv is CORWADO's reference of 30 October: 13 states and
 * administrative areas, 83 counties, 505 payams. Two things must hold for a
 * member's weather to follow their place:
 *   - every county has a weather point, or its members see "no weather";
 *   - every payam code is STATE-COUNTY-PAYAM, because the forecast route finds
 *     the county from the first two parts of the payam code.
 */

const queries: string[] = [];
vi.mock('../lib/db', () => ({
  prisma: {
    $queryRawUnsafe: async (sql: string) => {
      queries.push(sql);
      return [
        { id: 'loc-1', name: 'Juba County', lat: '4.85', lon: '31.6', last_fetched_at: null },
      ];
    },
  },
}));

describe('the national location list', () => {
  it('loads, validated, with the counts in the reference', async () => {
    const { loadSource, toTree } = await import('../../../scripts/locations-lib.mjs');
    const { placeholder, rows } = loadSource();
    expect(placeholder).toBe(false);
    const tree = toTree(rows);
    expect(tree.states).toHaveLength(13);
    expect(tree.counties).toHaveLength(83);
    expect(tree.payams).toHaveLength(505);
  });

  it('gives every payam a code its county can be read back from', async () => {
    const { loadSource, toTree } = await import('../../../scripts/locations-lib.mjs');
    const tree = toTree(loadSource().rows);
    const counties = new Map<string, string>(
      tree.counties.map((c: { id: string; state_id: string }) => [c.id, c.state_id]),
    );
    for (const p of tree.payams) {
      expect(p.id.split('-').slice(0, 2).join('-'), p.id).toBe(p.county_id);
      expect(counties.get(p.county_id), p.id).toBe(p.state_id);
    }
  });

  it('has a weather point inside South Sudan for every county', async () => {
    const { loadSource, toTree } = await import('../../../scripts/locations-lib.mjs');
    const { COUNTY_CENTROIDS } = await import('../../../scripts/weather-locations-lib.mjs');
    const tree = toTree(loadSource().rows);
    const centroids = COUNTY_CENTROIDS as Record<string, { latitude: number; longitude: number }>;
    const missing = tree.counties.filter((c: { name: string }) => !centroids[c.name]);
    expect(missing.map((c: { name: string }) => c.name)).toEqual([]);
    for (const c of tree.counties) {
      const { latitude, longitude } = centroids[c.name]!;
      expect(latitude, c.name).toBeGreaterThan(3.4);
      expect(latitude, c.name).toBeLessThan(12.3);
      expect(longitude, c.name).toBeGreaterThan(23.4);
      expect(longitude, c.name).toBeLessThan(36);
    }
  });
});

describe('the weather fetch cycle', () => {
  it('takes the least recently fetched first and stops when its time is spent', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { runWeatherFetch } = await import('../lib/weather/fetch-cycle');
    const out = await runWeatherFetch({ key: 'unused', floorMinutes: 45, budgetMs: 0 });
    expect(out).toEqual({ fetched: 0, skipped: 0, failed: 0, failures: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(queries.at(-1)).toMatch(/ORDER BY last_fetched_at ASC NULLS FIRST/);
    fetchSpy.mockRestore();
  });
});
