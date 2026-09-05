import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as farmerFarms from '../apps/web/app/api/farmers/[id]/farms/route';
import * as farmBoundaries from '../apps/web/app/api/farms/[id]/boundaries/route';
import * as farmCrops from '../apps/web/app/api/farms/[id]/crops/route';
import * as farmItem from '../apps/web/app/api/farms/[id]/route';
import * as geojson from '../apps/web/app/api/farms/geojson/route';
import * as farmers from '../apps/web/app/api/farmers/route';
import { RULE_MESSAGES } from '../apps/web/lib/api/errors';
import { makeTestPrisma, requireTestEnv } from './helpers/db';
import {
  FARMER_TEST_FAMILY,
  TEST_LOCATION_PREFIX,
  type TestPrincipal,
  createPrincipal,
  sweep,
} from './helpers/principals';
import { checked, data, errorOf, seenStatuses } from './helpers/scan';

/**
 * B7 — farms (C-7). Every response passes the shared scan (C-7.10).
 *
 * The expected area is computed here, independently of PostGIS, by the
 * spherical-excess formula on the authalic sphere (standing rule, DECISIONS:
 * a test that verifies a calculation computes the expected value on its own).
 * PostGIS measures on the WGS84 spheroid; at 5°N the two differ by about
 * 0.4%, inside the 1% the criterion allows.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });
requireTestEnv();
const run = describe;
const prisma = makeTestPrisma();

const STATE_A = 'CE';
const STATE_B = 'EE';
const PAYAM_A = 'CE-JUB-MUN';
const PAYAM_B = 'CE-JUB-KAT';
const COUNTY_EE = TEST_LOCATION_PREFIX;
const PAYAM_EE = `${TEST_LOCATION_PREFIX}-TST`;

let admin: TestPrincipal & { password: string };
let supervisorA: TestPrincipal & { password: string };
let readOnly: TestPrincipal & { password: string };
let officerA: TestPrincipal & { password: string };
let officerB: TestPrincipal & { password: string };
let officerEE: TestPrincipal & { password: string };

let phoneSeq = 6_000_000;
const farmerBody = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  given_name: 'Zzfarm',
  family_name: FARMER_TEST_FAMILY,
  sex: 'f',
  year_of_birth: 1980,
  phone: `+21191${String(1_000_000 + (phoneSeq += 1)).padStart(7, '0')}`,
  payam_id: PAYAM_A,
  consent: { text_version: 'v1.0-en', language: 'en', granted: true },
  ...overrides,
});
const registerFarmer = async (as: TestPrincipal, overrides: Record<string, unknown> = {}) => {
  const r = await checked(farmers, 'POST', { as, body: farmerBody(overrides) });
  expect(r.status, 'setup registration').toBe(201);
  return data(r).id as string;
};

// A ~1 ha quadrilateral near Juba: 100 m sides. Closed, counter-clockwise.
const LNG = 31.6,
  LAT = 4.85,
  D = 0.0009;
const SQUARE = {
  type: 'Polygon',
  coordinates: [
    [
      [LNG, LAT],
      [LNG + D, LAT],
      [LNG + D, LAT + D],
      [LNG, LAT + D],
      [LNG, LAT],
    ],
  ],
};
const reversed = (p: typeof SQUARE) => ({
  type: 'Polygon',
  coordinates: [[...p.coordinates[0]!].reverse()],
});
const farmBody = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  season: '2026-main',
  boundary: SQUARE,
  gps_accuracy_m: 6,
  ...overrides,
});

/** Spherical excess area, authalic radius, hectares. Independent of PostGIS. */
function sphericalHectares(ring: number[][]): number {
  const R = 6371008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [l1, p1] = ring[i]!;
    const [l2, p2] = ring[i + 1]!;
    sum += (rad(l2!) - rad(l1!)) * (2 + Math.sin(rad(p1!)) + Math.sin(rad(p2!)));
  }
  return Math.abs((sum * R * R) / 2) / 10_000;
}

const mapFarm = async (
  as: TestPrincipal,
  farmerId: string,
  overrides: Record<string, unknown> = {},
) => {
  const r = await checked(farmerFarms, 'POST', {
    as,
    params: { id: farmerId },
    body: farmBody(overrides),
  });
  expect(r.status, 'setup farm').toBe(201);
  return data(r);
};
const currentRows = (farmId: string) =>
  prisma.$queryRawUnsafe<
    { id: string; is_current: boolean; area_ha: string; accuracy_flag: string }[]
  >(
    `SELECT id, is_current, area_ha::text AS area_ha, accuracy_flag::text AS accuracy_flag FROM public.farm_boundary WHERE farm_id = $1::uuid ORDER BY mapped_at`,
    farmId,
  );

beforeAll(async () => {
  await sweep(prisma);
  await prisma.$executeRawUnsafe(
    `INSERT INTO public.county (id, name, state_id) VALUES ($1, 'zztest county', $2) ON CONFLICT (id) DO NOTHING`,
    COUNTY_EE,
    STATE_B,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO public.payam (id, name, county_id, state_id) VALUES ($1, 'zztest payam', $2, $3) ON CONFLICT (id) DO NOTHING`,
    PAYAM_EE,
    COUNTY_EE,
    STATE_B,
  );
  admin = await createPrincipal(prisma, 'admin');
  supervisorA = await createPrincipal(prisma, 'supervisor', { stateId: STATE_A });
  readOnly = await createPrincipal(prisma, 'read_only', { stateId: STATE_A });
  officerA = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
  officerB = await createPrincipal(prisma, 'officer', { payamId: PAYAM_B });
  officerEE = await createPrincipal(prisma, 'officer', { payamId: PAYAM_EE });
});
afterAll(async () => {
  await sweep(prisma);
  await prisma.$disconnect();
});

run('who maps (C-7.6)', () => {
  it('an admin cannot create a farm, add a boundary, or record crops — refused by the route, and refused by the schema', async () => {
    const farmerId = await registerFarmer(officerA);
    const farm = await mapFarm(officerA, farmerId);
    expect(
      (
        await checked(farmerFarms, 'POST', {
          as: admin,
          params: { id: farmerId },
          body: farmBody(),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await checked(farmBoundaries, 'POST', {
          as: admin,
          params: { id: farm.id as string },
          body: { season: '2026-second', boundary: SQUARE, gps_accuracy_m: 5 },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await checked(farmCrops, 'PUT', {
          as: admin,
          params: { id: farm.id as string },
          body: { season: '2026-main', crops: ['maize'] },
        })
      ).status,
    ).toBe(403);
    // The schema: mapped_by references officer, so an administrator's id is refused by the database itself.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO public.farm_boundary (farm_id, season, boundary, centroid, area_ha, point_count, gps_accuracy_m, accuracy_flag, mapped_by, is_current)
         SELECT $1::uuid, '2027-main', b.boundary, b.centroid, b.area_ha, b.point_count, b.gps_accuracy_m, b.accuracy_flag, $2::uuid, true
         FROM public.farm_boundary b WHERE b.farm_id = $1::uuid LIMIT 1`,
        farm.id,
        admin.id,
      ),
    ).rejects.toThrow(/farm_boundary_mapped_by_fkey/);
  });
  it("an officer cannot map a farmer outside their caseload: 404, and cannot re-map another officer's farm", async () => {
    const farmerId = await registerFarmer(officerA);
    expect(
      (
        await checked(farmerFarms, 'POST', {
          as: officerB,
          params: { id: farmerId },
          body: farmBody(),
        })
      ).status,
    ).toBe(404);
    const farm = await mapFarm(officerA, farmerId);
    expect(
      (
        await checked(farmBoundaries, 'POST', {
          as: officerB,
          params: { id: farm.id as string },
          body: { season: '2026-second', boundary: SQUARE, gps_accuracy_m: 5 },
        })
      ).status,
    ).toBe(404);
  });
});

run('the boundary (C-7.2, C-7.3, C-7.4)', () => {
  it('not closed, crosses itself, three vertices: each refused with its own pinned sentence', async () => {
    const farmerId = await registerFarmer(officerA);
    const open = {
      type: 'Polygon',
      coordinates: [
        [
          [LNG, LAT],
          [LNG + D, LAT],
          [LNG + D, LAT + D],
          [LNG, LAT + D],
        ],
      ],
    };
    const bowtie = {
      type: 'Polygon',
      coordinates: [
        [
          [LNG, LAT],
          [LNG + D, LAT + D],
          [LNG + D, LAT],
          [LNG, LAT + D],
          [LNG, LAT],
        ],
      ],
    };
    const triangle = {
      type: 'Polygon',
      coordinates: [
        [
          [LNG, LAT],
          [LNG + D, LAT],
          [LNG, LAT + D],
          [LNG, LAT],
        ],
      ],
    };
    for (const [shape, rule] of [
      [open, 'boundary_not_closed'],
      [bowtie, 'boundary_crosses_itself'],
      [triangle, 'boundary_too_few_points'],
    ] as const) {
      const r = await checked(farmerFarms, 'POST', {
        as: officerA,
        params: { id: farmerId },
        body: farmBody({ boundary: shape }),
      });
      expect(r.status, rule).toBe(422);
      expect(errorOf(r).message).toBe(RULE_MESSAGES[rule]);
    }
    const counted = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT count(*) AS n FROM public.farm WHERE farmer_id = $1::uuid',
      farmerId,
    );
    expect(Number(counted[0]?.n)).toBe(0);
  });
  it('area of a known polygon in Central Equatoria is within 1% of the independently computed hectares', async () => {
    const farmerId = await registerFarmer(officerA);
    const farm = await mapFarm(officerA, farmerId);
    const b = (farm.boundaries as { area_ha: number }[])[0]!;
    const expected = sphericalHectares(SQUARE.coordinates[0]!);
    expect(expected).toBeGreaterThan(0.9);
    expect(expected).toBeLessThan(1.1);
    expect(Math.abs(b.area_ha - expected) / expected).toBeLessThan(0.01);
  });
  it('winding order: the same plot walked clockwise is accepted with the same positive area', async () => {
    const farmerId = await registerFarmer(officerA);
    const ccw = await mapFarm(officerA, farmerId);
    const cw = await mapFarm(officerA, farmerId, { boundary: reversed(SQUARE) });
    const a1 = (ccw.boundaries as { area_ha: number }[])[0]!.area_ha;
    const a2 = (cw.boundaries as { area_ha: number }[])[0]!.area_ha;
    expect(a2).toBeGreaterThan(0);
    expect(a2).toBe(a1);
  });
  it('accuracy at exactly 10 and exactly 30 metres grades good and poor; 30.1 is unusable and saved', async () => {
    const farmerId = await registerFarmer(officerA);
    for (const [m, grade] of [
      [10, 'good'],
      [30, 'poor'],
      [30.1, 'unusable'],
    ] as const) {
      const farm = await mapFarm(officerA, farmerId, { gps_accuracy_m: m });
      expect((farm.boundaries as { grade: string }[])[0]!.grade, `${m} m`).toBe(grade);
    }
  });
});

run('history and superseding (C-7.5)', () => {
  it('superseding within a season leaves both rows, one current, and the history route shows both', async () => {
    const farmerId = await registerFarmer(officerA);
    const farm = await mapFarm(officerA, farmerId);
    const r = await checked(farmBoundaries, 'POST', {
      as: officerA,
      params: { id: farm.id as string },
      body: { season: '2026-main', boundary: reversed(SQUARE), gps_accuracy_m: 12 },
    });
    expect(r.status).toBe(201);
    expect(data(r).superseded).toBeTruthy();
    const rows = await currentRows(farm.id as string);
    expect(rows.length).toBe(2);
    expect(rows.filter((x) => x.is_current).length).toBe(1);
    const hist = await checked(farmBoundaries, 'GET', {
      as: officerA,
      params: { id: farm.id as string },
    });
    expect((hist.body.data as unknown[]).length).toBe(2);
  });
  it('two concurrent supersedes cannot both end current — the partial index holds', async () => {
    const farmerId = await registerFarmer(officerA);
    const farm = await mapFarm(officerA, farmerId);
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        checked(farmBoundaries, 'POST', {
          as: officerA,
          params: { id: farm.id as string },
          body: { season: '2026-main', boundary: SQUARE, gps_accuracy_m: 5 + i },
        }),
      ),
    );
    for (const r of results) expect([201, 409]).toContain(r.status);
    expect(results.some((r) => r.status === 201)).toBe(true);
    for (const r of results.filter((x) => x.status === 409))
      expect(errorOf(r).message).toBe(RULE_MESSAGES.boundary_recorded_concurrently);
    const rows = await currentRows(farm.id as string);
    expect(rows.filter((x) => x.is_current).length).toBe(1);
  });
});

run('visibility, totals, the map (C-7.4, C-7.8, C-7.9)', () => {
  it("a supervisor's response has no coordinates key at all, not a masked one; the mapping officer and the admin have them", async () => {
    const farmerId = await registerFarmer(officerA);
    const farm = await mapFarm(officerA, farmerId);
    const sup = await checked(farmItem, 'GET', {
      as: supervisorA,
      params: { id: farm.id as string },
    });
    expect(sup.status).toBe(200);
    const b = (data(sup).boundaries as Record<string, unknown>[])[0]!;
    for (const key of ['boundary', 'centroid', 'gps_accuracy_m']) expect(key in b, key).toBe(false);
    expect(b.area_ha).toBeGreaterThan(0);
    expect(b.grade).toBe('good');
    const ro = await checked(farmItem, 'GET', { as: readOnly, params: { id: farm.id as string } });
    expect('boundary' in (data(ro).boundaries as Record<string, unknown>[])[0]!).toBe(false);
    for (const who of [admin, officerA]) {
      const r = await checked(farmItem, 'GET', { as: who, params: { id: farm.id as string } });
      const bb = (data(r).boundaries as Record<string, unknown>[])[0]!;
      expect((bb.boundary as { type: string }).type).toBe('Polygon');
      expect((bb.centroid as { type: string }).type).toBe('Point');
      expect(bb.gps_accuracy_m).toBe(6);
    }
  });
  it('unusable boundaries are saved and excluded from area totals; soft-deleted farms too; the map excludes both', async () => {
    const farmerId = await registerFarmer(officerA, { payam_id: PAYAM_A });
    const good = await mapFarm(officerA, farmerId, { season: '2027-main' });
    const bad = await mapFarm(officerA, farmerId, { season: '2027-main', gps_accuracy_m: 45 });
    const gone = await mapFarm(officerA, farmerId, { season: '2027-main' });
    expect(
      (await checked(farmItem, 'DELETE', { as: admin, params: { id: gone.id as string } })).status,
    ).toBe(204);
    const totals = await prisma.$queryRawUnsafe<{ farms: number; hectares: string }[]>(
      `SELECT farms, hectares::text AS hectares FROM public.area_totals_v WHERE payam_id = $1 AND season = '2027-main'`,
      PAYAM_A,
    );
    const counted = await prisma.$queryRawUnsafe<{ ids: string[] }[]>(
      `SELECT array_agg(f.id::text) AS ids FROM public.farm_mapped_v f WHERE f.farmer_id = $1::uuid`,
      farmerId,
    );
    expect(counted[0]?.ids ?? []).toEqual([good.id]);
    expect(Number(totals[0]?.farms)).toBeGreaterThanOrEqual(1);
    const map = await checked(geojson, 'GET', {
      as: supervisorA,
      query: { payam: PAYAM_A, season: '2027-main', limit: '100' },
    });
    expect(map.status).toBe(200);
    const ids = (map.body.data as { id: string }[]).map((f) => f.id);
    expect(ids).toContain(good.id);
    expect(ids).not.toContain(bad.id);
    expect(ids).not.toContain(gone.id);
    expect((map.body.page as { type: string }).type).toBe('FeatureCollection');
    const bySup = await checked(farmItem, 'GET', {
      as: supervisorA,
      params: { id: bad.id as string },
    });
    expect((data(bySup).boundaries as { grade: string }[])[0]!.grade).toBe('unusable');
    expect(
      (await checked(farmItem, 'GET', { as: admin, params: { id: gone.id as string } })).status,
    ).toBe(404);
  });
  it('a supervisor in state A gets nothing from state B: 404 on the farm, and the map shows only their state', async () => {
    const eeFarmer = await registerFarmer(officerEE, { payam_id: PAYAM_EE });
    const ee = await mapFarm(officerEE, eeFarmer);
    expect(
      (await checked(farmItem, 'GET', { as: supervisorA, params: { id: ee.id as string } })).status,
    ).toBe(404);
    const map = await checked(geojson, 'GET', { as: supervisorA, query: { limit: '100' } });
    expect(
      (map.body.data as { properties: { state_id: string } }[]).every(
        (f) => f.properties.state_id === STATE_A,
      ),
    ).toBe(true);
    expect((await checked(geojson, 'GET', { as: readOnly })).status).toBe(403);
  });
  it('crops per farm per season, replaced by PUT, audited', async () => {
    const farmerId = await registerFarmer(officerA);
    const farm = await mapFarm(officerA, farmerId);
    const r1 = await checked(farmCrops, 'PUT', {
      as: officerA,
      params: { id: farm.id as string },
      body: { season: '2026-main', crops: ['maize', 'sorghum'] },
    });
    expect(r1.status).toBe(200);
    const r2 = await checked(farmCrops, 'PUT', {
      as: officerA,
      params: { id: farm.id as string },
      body: { season: '2026-main', crops: ['sesame'] },
    });
    expect((r2.body.data as { crop: string }[]).map((c) => c.crop)).toEqual(['sesame']);
    const audit = await prisma.$queryRawUnsafe<{ action: string }[]>(
      `SELECT action FROM public.audit_event WHERE entity_type = 'farm' AND entity_id = $1 ORDER BY occurred_at`,
      farm.id,
    );
    expect(audit.map((a) => a.action)).toEqual([
      'farm.created',
      'farm.boundary_added',
      'farm.crops_declared',
      'farm.crops_declared',
    ]);
  });
  it('every error status this unit produces was scanned', () => {
    for (const status of [403, 404, 422, 409])
      expect(seenStatuses.has(status), `no ${status} scanned`).toBe(true);
  });
});
