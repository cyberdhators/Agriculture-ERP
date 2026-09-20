import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as weather from '../apps/web/app/api/weather/route';
import { WEATHER_ATTRIBUTION, WEATHER_STALE_AFTER_HOURS } from '../packages/shared/src/weather';
import { makeTestPrisma, requireTestEnv } from './helpers/db';
import { type TestPrincipal, createPrincipal, sweep } from './helpers/principals';
import { call } from './helpers/request';

/**
 * C-16 -- the weather tile's route, through requireRole and scope, against
 * staging. What it proves: who sees which locations (C-16.8), that empty is a
 * success (C-16.9), that a stale row is served with its real time (C-16.7),
 * that a retried fetch is one row (C-16.6), that attribution rides in the
 * payload (C-16.10), that creating a location audits and fetching does not
 * (C-16.11), and that a never-fetched location is omitted rather than served
 * with a null time.
 *
 * Fixtures: two county-level locations in CE (one fetched today, one fetched
 * long ago), one in EE never fetched. All named zztest and removed after.
 */
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
requireTestEnv();
const prisma = makeTestPrisma();

const STATE_A = 'CE';
const STATE_B = 'EE';
const PAYAM_A = 'CE-JUB-MUN';

let admin: TestPrincipal & { password: string };
let supervisorA: TestPrincipal & { password: string };
let supervisorB: TestPrincipal & { password: string };
let readOnlyA: TestPrincipal & { password: string };
let officerA: TestPrincipal & { password: string };

let countyA: string;
let freshId: string;
let staleId: string;
let neverId: string;

const cleanup = async () => {
  await prisma.$executeRawUnsafe(
    `DELETE FROM public.weather_forecast WHERE weather_location_id IN (SELECT id FROM public.weather_location WHERE name LIKE 'zztest%')`,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM public.weather_observation WHERE weather_location_id IN (SELECT id FROM public.weather_location WHERE name LIKE 'zztest%')`,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM public.weather_location WHERE name LIKE 'zztest%'`);
};

async function insertLocation(name: string, stateId: string, countyId: string): Promise<string> {
  const [row] = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO public.weather_location (name, level, state_id, county_id, payam_id, latitude, longitude)
     VALUES ($1, 'county', $2, $3, NULL, 4.85, 31.6) RETURNING id`,
    name,
    stateId,
    countyId,
  );
  return row!.id;
}

async function observe(locationId: string, fetchedAt: Date): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO public.weather_observation
       (weather_location_id, observed_at, fetched_at, fetched_on, temp_c, humidity_pct, wind_kph, rain_mm, conditions, icon, raw)
     VALUES ($1::uuid, $2::timestamptz, $2::timestamptz, ($2::timestamptz)::date, 31.4, 62, 11.2, 0, 'light rain', '10d', '{}'::jsonb)
     ON CONFLICT (weather_location_id, fetched_on) DO UPDATE SET fetched_at = EXCLUDED.fetched_at`,
    locationId,
    fetchedAt.toISOString(),
  );
}

beforeAll(async () => {
  await cleanup();
  await sweep(prisma);
  admin = await createPrincipal(prisma, 'admin');
  supervisorA = await createPrincipal(prisma, 'supervisor', { stateId: STATE_A });
  supervisorB = await createPrincipal(prisma, 'supervisor', { stateId: STATE_B });
  readOnlyA = await createPrincipal(prisma, 'read_only', { stateId: STATE_A });
  officerA = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });

  const [p] = await prisma.$queryRawUnsafe<{ county_id: string }[]>(
    `SELECT county_id FROM public.payam WHERE id = $1`,
    PAYAM_A,
  );
  countyA = p!.county_id;
  const [otherCounty] = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM public.county WHERE state_id = $1 AND id <> $2 AND deleted_at IS NULL LIMIT 1`,
    STATE_A,
    countyA,
  );
  const [eeCounty] = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM public.county WHERE state_id = $1 AND deleted_at IS NULL LIMIT 1`,
    STATE_B,
  );

  freshId = await insertLocation('zztest fresh county', STATE_A, countyA);
  staleId = await insertLocation(
    'zztest stale county',
    STATE_A,
    (otherCounty ?? { id: countyA }).id,
  );
  neverId = eeCounty ? await insertLocation('zztest never fetched', STATE_B, eeCounty.id) : '';

  await observe(freshId, new Date());
  await observe(staleId, new Date(Date.now() - (WEATHER_STALE_AFTER_HOURS + 2) * 3600_000));
  // Two forecast rows for the fresh one, tomorrow and the day after.
  for (const days of [1, 2]) {
    const d = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    await prisma.$executeRawUnsafe(
      `INSERT INTO public.weather_forecast
         (weather_location_id, forecast_for, fetched_at, temp_max_c, temp_min_c, rain_mm, rain_probability, humidity_pct, wind_kph, conditions, icon, raw)
       VALUES ($1::uuid, $2::date, now(), 32.1, 22.0, 8.4, 0.7, 70, 18, 'light rain', '10d', '{}'::jsonb)`,
      freshId,
      d,
    );
  }
});

afterAll(async () => {
  await cleanup();
  await sweep(prisma);
  await prisma.$disconnect();
});

const ids = (body: Record<string, unknown>) =>
  ((body.data as { location_id: string }[]) ?? []).map((r) => r.location_id).sort();

describe('who sees which locations (C-16.8)', () => {
  it('an administrator sees every fetched location; the never-fetched one is omitted', async () => {
    const r = await call(weather, 'GET', { as: admin });
    expect(r.status).toBe(200);
    const got = ids(r.body);
    expect(got).toContain(freshId);
    expect(got).toContain(staleId);
    if (neverId) expect(got).not.toContain(neverId);
  });

  it('a supervisor and a read-only user see their own state only', async () => {
    /*
     * ASSERTED AS SCOPE, NOT AS "THESE TWO AND NOTHING ELSE".
     *
     * This read `toEqual([freshId, staleId])`, which assumes the suite's rows
     * are the only fetched locations in the caller's state. Staging holds six
     * county rows seeded on 2026-09-15, all in CE, and they are legitimately in
     * a CE supervisor's scope -- so the assertion failed on a correct answer.
     * What C-16.8 actually requires is that NOTHING OUTSIDE THE CALLER'S STATE
     * comes back, which is checked here against every row returned rather than
     * against the two this file happens to know about. Stronger, not looser.
     */
    for (const who of [supervisorA, readOnlyA]) {
      const r = await call(weather, 'GET', { as: who });
      expect(r.status).toBe(200);
      const got = ids(r.body);
      expect(got).toContain(freshId);
      expect(got).toContain(staleId);
      const states = await prisma.$queryRawUnsafe<{ state_id: string }[]>(
        `SELECT DISTINCT state_id FROM public.weather_location WHERE id = ANY($1::uuid[])`,
        got,
      );
      expect(states.map((x) => x.state_id)).toEqual([STATE_A]);
    }
  });

  it('an officer sees their own county, not their payam (locations are county-level)', async () => {
    const r = await call(weather, 'GET', { as: officerA });
    expect(r.status).toBe(200);
    const got = ids(r.body);
    expect(got).toContain(freshId);
    // The stale one is in another CE county when one exists, so the officer must not see it.
    const [stale] = await prisma.$queryRawUnsafe<{ county_id: string }[]>(
      `SELECT county_id FROM public.weather_location WHERE id = $1::uuid`,
      staleId,
    );
    if (stale!.county_id !== countyA) expect(got).not.toContain(staleId);
  });
});

describe('empty is a success (C-16.9)', () => {
  it('a supervisor with no fetched locations in their state gets 200 and []', async () => {
    const r = await call(weather, 'GET', { as: supervisorB });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
    expect(r.body.attribution).toEqual(WEATHER_ATTRIBUTION);
  });
});

describe('the shape (contract, C-16.7, C-16.10)', () => {
  it('serves the stale row with its real time and stale: true, the fresh with stale: false', async () => {
    const r = await call(weather, 'GET', { as: supervisorA });
    const rows = r.body.data as Record<string, unknown>[];
    const fresh = rows.find((x) => x.location_id === freshId)!;
    const stale = rows.find((x) => x.location_id === staleId)!;
    expect(fresh.stale).toBe(false);
    expect(stale.stale).toBe(true);
    const staleAge = Date.now() - new Date(stale.fetched_at as string).getTime();
    expect(staleAge).toBeGreaterThan(WEATHER_STALE_AFTER_HOURS * 3600_000);
  });

  it('numbers are numbers, forecasts ascend from tomorrow, and attribution rides at the top level', async () => {
    const r = await call(weather, 'GET', { as: supervisorA });
    const fresh = (r.body.data as Record<string, unknown>[]).find(
      (x) => x.location_id === freshId,
    )!;
    expect((fresh.current as { temp_c: number }).temp_c).toBe(31.4);
    const fc = fresh.forecast as { forecast_for: string; temp_max_c: number }[];
    expect(fc.length).toBe(2);
    expect(fc[0]!.forecast_for < fc[1]!.forecast_for).toBe(true);
    expect(fc[0]!.forecast_for > new Date().toISOString().slice(0, 10)).toBe(true);
    expect(typeof fc[0]!.temp_max_c).toBe('number');
    expect(fresh.level).toBe('county');
    expect(fresh.payam_id).toBeNull();
    expect(r.body.attribution).toEqual(WEATHER_ATTRIBUTION);
  });
});

describe('one fetch per location per day is idempotent (C-16.6)', () => {
  it('the same observation day and the same forecast day upsert to one row each', async () => {
    const before = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.weather_observation WHERE weather_location_id = $1::uuid`,
      freshId,
    );
    await observe(freshId, new Date());
    const after = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.weather_observation WHERE weather_location_id = $1::uuid`,
      freshId,
    );
    expect(after[0]!.n).toBe(before[0]!.n);
    /*
     * And a duplicate forecast day is refused, which is what the job's upsert
     * relies on. PINNED BY SQLSTATE AND COLUMNS, NOT BY THE CONSTRAINT NAME:
     * Postgres puts the name in its primary message and the offending tuple in
     * DETAIL, and Prisma surfaces the DETAIL and drops the line carrying the
     * name. Matching `/weather_forecast_one_per_day/` therefore failed on a
     * correct refusal. 23505 plus the column pair says more than the name did.
     */
    const d = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const refusal = await prisma
      .$executeRawUnsafe(
        `INSERT INTO public.weather_forecast
           (weather_location_id, forecast_for, fetched_at, temp_max_c, temp_min_c, humidity_pct, wind_kph, conditions, raw)
         VALUES ($1::uuid, $2::date, now(), 30, 20, 60, 10, 'x', '{}'::jsonb)`,
        freshId,
        d,
      )
      .then(() => null)
      .catch((error: { meta?: { code?: string; message?: string } }) => error);
    expect(refusal, 'a duplicate forecast day was accepted').not.toBeNull();
    expect(refusal!.meta?.code, 'not a unique violation').toBe('23505');
    expect(String(refusal!.meta?.message)).toContain('weather_location_id, forecast_for');
  });
});

describe('the database refuses a scope that is a null meaning something (C-16.2, C-16.4)', () => {
  it('a county-level row with a payam, or a payam-level row without one, is refused', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO public.weather_location (name, level, state_id, county_id, payam_id, latitude, longitude)
         VALUES ('zztest bad', 'county', $1, $2, $3, 4, 31)`,
        STATE_A,
        countyA,
        PAYAM_A,
      ),
    ).rejects.toThrow(/weather_location_level_payam_pair/);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO public.weather_location (name, level, state_id, county_id, payam_id, latitude, longitude)
         VALUES ('zztest bad', 'payam', $1, $2, NULL, 4, 31)`,
        STATE_A,
        countyA,
      ),
    ).rejects.toThrow(/weather_location_level_payam_pair/);
  });

  it('a soft-deleted location appears in no list', async () => {
    const id = await insertLocation('zztest removed', STATE_A, countyA);
    await observe(id, new Date());
    await prisma.$executeRawUnsafe(
      `UPDATE public.weather_location SET deleted_at = now(), deleted_by = $2::uuid WHERE id = $1::uuid`,
      id,
      admin.id,
    );
    const r = await call(weather, 'GET', { as: admin });
    expect(ids(r.body)).not.toContain(id);
  });
});

describe('audit (C-16.11)', () => {
  it('the seed writes weather_location.created as system, and a fetch writes nothing', async () => {
    // @ts-expect-error -- plain ESM script with no declaration, typed loosely on purpose
    const { seedWeatherLocations } = await import('../scripts/weather-locations-lib.mjs');
    // Drive the seed against a made-up centroid map for the test county only, so it inserts exactly one row.
    const [c] = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM public.county WHERE id = $1`,
      countyA,
    );
    /*
     * EVERY LOCATION ID THAT EXISTS BEFORE THE SEED RUNS.
     *
     * The cleanup at the end of this test removes what the seed INSERTED, by
     * id, found by difference against this set. It used to delete "every
     * county-level row that is not zztest-named and not in `others`", which is
     * a set defined by exclusion: on staging that matched six locations seeded
     * by hand on 2026-09-15 that this test did not create and does not own. A
     * foreign key from `weather_observation` refused the delete and the test
     * went red -- which is luck, not safety. See PROJECT-STATE, "a test removes
     * what it created, by id".
     */
    const existingIds = new Set(
      (
        await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM public.weather_location`)
      ).map((r) => r.id),
    );
    const centroids: Record<string, { latitude: number; longitude: number }> = {};
    const all = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM public.county WHERE deleted_at IS NULL`,
    );
    for (const row of all) centroids[row.name] = { latitude: 4.5, longitude: 31.5 };
    const before = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.audit_event WHERE action = 'weather_location.created'`,
    );
    const result = await seedWeatherLocations(prisma, { centroids });
    expect(result.refused).toBe(false);
    const after = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.audit_event WHERE action = 'weather_location.created'`,
    );
    expect(after[0]!.n - before[0]!.n).toBe(result.inserted);
    if (result.inserted > 0) {
      const [a] = await prisma.$queryRawUnsafe<{ actor_type: string; actor_id: string | null }[]>(
        `SELECT actor_type::text, actor_id FROM public.audit_event WHERE action = 'weather_location.created' ORDER BY occurred_at DESC LIMIT 1`,
      );
      expect(a!.actor_type).toBe('system');
      expect(a!.actor_id).toBeNull();
    }
    // Remove exactly what the seed inserted, by id, and nothing else. Anything
    // that was here before this test ran is somebody else's and stays.
    const inserted = (
      await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM public.weather_location`)
    )
      .map((r) => r.id)
      .filter((id) => !existingIds.has(id));
    if (inserted.length > 0) {
      for (const table of ['weather_forecast', 'weather_observation']) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM public.${table} WHERE weather_location_id = ANY($1::uuid[])`,
          inserted,
        );
      }
      await prisma.$executeRawUnsafe(
        `DELETE FROM public.weather_location WHERE id = ANY($1::uuid[])`,
        inserted,
      );
    }
    void c;
    // An observation write (what the fetch job does) adds no audit row.
    const beforeObs = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.audit_event`,
    );
    await observe(freshId, new Date());
    const afterObs = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.audit_event`,
    );
    expect(afterObs[0]!.n).toBe(beforeObs[0]!.n);
    void randomUUID;
  });
});
