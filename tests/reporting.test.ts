import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as farmerFarms from '../apps/web/app/api/farmers/[id]/farms/route';
import * as farmerMerge from '../apps/web/app/api/farmers/[id]/merge/route';
import * as farmerReject from '../apps/web/app/api/farmers/[id]/reject/route';
import * as farmerItem from '../apps/web/app/api/farmers/[id]/route';
import * as farmerVerify from '../apps/web/app/api/farmers/[id]/verify/route';
import * as farmerVisits from '../apps/web/app/api/farmers/[id]/visits/route';
import * as farmers from '../apps/web/app/api/farmers/route';
import * as farmCrops from '../apps/web/app/api/farms/[id]/crops/route';
import * as reportExports from '../apps/web/app/api/reports/exports/route';
import * as reportSummary from '../apps/web/app/api/reports/summary/route';
import {
  AGE_BAND_NOTE,
  CROP_NOTE,
  REPORT_MESSAGES,
  ageBandAt,
} from '../packages/shared/src/report';
import { makeTestPrisma, requireTestEnv } from './helpers/db';
import {
  FARMER_TEST_FAMILY,
  TEST_LOCATION_PREFIX,
  type TestPrincipal,
  createPrincipal,
  sweep,
} from './helpers/principals';
import { ADVICE, GIVEN, NATIONAL_ID, checked, data, errorOf, rememberPhone } from './helpers/scan';

/**
 * B10 — dashboards, reporting and export (C-10). Every expected total below is
 * computed here from the fixtures, never read from the view it checks
 * (C-10.14). The fixture is small enough to count by hand:
 *
 *   state CE, payam A (officer A)      state CE, payam B (officer B)   state EE
 *   F1 verified, f, 1990, farm+crops   F2 verified, m, 1970, farm       F7 pending
 *      two visits (one last month)        one visit
 *   F3 pending, one visit
 *   F4 rejected
 *   F5 merged into F1, farm + visit  -> repointed to F1
 *   F6 verified then removed, farm + visit -> in nothing
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
let supervisorB: TestPrincipal & { password: string };
let readOnly: TestPrincipal & { password: string };
let officerA: TestPrincipal & { password: string };
let officerB: TestPrincipal & { password: string };
let officerEE: TestPrincipal & { password: string };

let phoneSeq = 4_500_000;
const farmerBody = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  given_name: GIVEN,
  family_name: FARMER_TEST_FAMILY,
  sex: 'f',
  year_of_birth: 1990,
  phone: rememberPhone(`+21194${String(1_000_000 + (phoneSeq += 1)).padStart(7, '0')}`),
  national_id: NATIONAL_ID,
  payam_id: PAYAM_A,
  consent: { text_version: 'v1.0-en', language: 'en', granted: true },
  ...overrides,
});
const register = async (as: TestPrincipal, overrides: Record<string, unknown> = {}) => {
  const r = await checked(farmers, 'POST', { as, body: farmerBody(overrides) });
  expect(r.status, `setup registration: ${r.text}`).toBe(201);
  return data(r);
};
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
/** Spherical excess, authalic radius, hectares — independent of PostGIS (the B7 rule). */
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
const ONE_FARM_HA = sphericalHectares(SQUARE.coordinates[0]!);
const SEASON = '2026-main';
const mapFarm = async (as: TestPrincipal, farmerId: string, crops: string[]) => {
  const r = await checked(farmerFarms, 'POST', {
    as,
    params: { id: farmerId },
    body: {
      id: randomUUID(),
      boundary_id: randomUUID(),
      season: SEASON,
      boundary: SQUARE,
      gps_accuracy_m: 6,
    },
  });
  expect(r.status, `setup farm: ${r.text}`).toBe(201);
  const farmId = data(r).id as string;
  if (crops.length) {
    const c = await checked(farmCrops, 'PUT', {
      as,
      params: { id: farmId },
      body: { season: SEASON, crops },
    });
    expect(c.status, `setup crops: ${c.text}`).toBe(200);
  }
  return farmId;
};
const visit = async (as: TestPrincipal, farmerId: string) => {
  const r = await checked(farmerVisits, 'POST', {
    as,
    params: { id: farmerId },
    body: {
      id: randomUUID(),
      visited_at: new Date(Date.now() - 3_600_000).toISOString(),
      position: { type: 'Point', coordinates: [LNG + 0.0004, LAT + 0.0003] },
      gps_accuracy_m: 6,
      advice: ADVICE,
      topics: ['weeding'],
    },
  });
  expect(r.status, `setup visit: ${r.text}`).toBe(201);
  return data(r).id as string;
};
const verify = async (id: string) =>
  expect(
    (await checked(farmerVerify, 'POST', { as: admin, params: { id }, body: {} })).status,
  ).toBe(200);
const summary = async (as: TestPrincipal, query: Record<string, string> = {}) => {
  const r = await checked(reportSummary, 'GET', { as, query });
  expect(r.status, r.text).toBe(200);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the summary is asserted shape by shape below
  return data(r) as Record<string, any>;
};

const F: Record<string, string> = {};
let f5Farm = '';
let f5Visit = '';
let f6Farm = '';
const LAST_MONTH = new Date(Date.now() - 40 * 86_400_000);

/*
 * ============================================================================
 * COUNTING THE FIXTURE, NOT THE DATABASE.
 * ============================================================================
 *
 * Every figure below is counted by hand from the fixture at the top of this
 * file. It used to be asserted against the WHOLE total the route returned,
 * which quietly assumed that the fixture is the only thing in the database.
 * That assumption is not the project's: CLAUDE.md section 4 says staging rows
 * are the suite's or the seed's, and warns in the same breath that "a row made
 * by hand outside that convention breaks the sweep for everyone". One did --
 * a pending farmer in CE, created by hand before this suite ran, which the
 * sweep correctly refuses to touch because it is not a zztest row. It is not
 * this suite's to delete, and it must not be this suite's to trip over.
 *
 * So each figure is now asserted against the DIFFERENCE: the same summary is
 * taken once before the fixture exists and once after, and the hand-counted
 * expectations below are unchanged, because the fixture's contribution is
 * exactly what they always described. A row this suite did not create cancels
 * out of both sides.
 *
 * WHAT THIS DOES NOT DO is weaken the figure. The route still computes over
 * everything it can see; a double count, a miscounted merge, a farm counted
 * for a removed farmer, a scope that leaks the fixture's own rows -- each
 * still lands in the difference and still fails. What cancels is only what was
 * already there when the suite started.
 */

/** Fixed at import so the baseline and the observation ask for the same window. */
const RECENT_FROM = new Date(Date.now() - 7 * 86_400_000).toISOString();
const AROUND_LAST_MONTH = {
  from: new Date(LAST_MONTH.getTime() - 86_400_000).toISOString(),
  to: new Date(LAST_MONTH.getTime() + 86_400_000).toISOString(),
};

/** Every (caller, filter) pair a hand-counted figure is asserted against. */
const VIEWS = {
  ce: () => [supervisorA, { season: SEASON }],
  ceRecent: () => [supervisorA, { season: SEASON, from: RECENT_FROM }],
  ceAroundLastMonth: () => [supervisorA, { season: SEASON, ...AROUND_LAST_MONTH }],
  caseloadA: () => [officerA, { season: SEASON }],
  national: () => [admin, { season: SEASON }],
  ee: () => [supervisorB, { season: SEASON }],
  eeAskingForCe: () => [supervisorB, { season: SEASON, state: STATE_A }],
  readOnlyCe: () => [readOnly, { season: SEASON }],
} satisfies Record<string, () => [TestPrincipal, Record<string, string>]>;

type ViewName = keyof typeof VIEWS;

/** What each view already said before a single fixture row existed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the summary is asserted shape by shape below
const BASELINE = {} as Record<ViewName, Record<string, any>>;

/** after − before, field by field. */
const minus = (after: Record<string, number>, before: Record<string, number>) =>
  Object.fromEntries(Object.keys(after).map((k) => [k, after[k]! - (before[k] ?? 0)]));

/** after − before, row by row on `key`; a row that nets to nothing disappears. */
function minusRows<T extends { key: string }>(after: T[], before: T[]): T[] {
  const had = new Map(before.map((row) => [row.key, row as Record<string, unknown>]));
  return after
    .map(
      (row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) =>
            k === 'key'
              ? [k, v]
              : [k, (v as unknown as number) - ((had.get(row.key)?.[k] as number) ?? 0)],
          ),
        ) as T,
    )
    .filter((row) =>
      Object.entries(row).some(([k, v]) => k !== 'key' && (v as unknown as number) !== 0),
    );
}

/**
 * The summary with every additive figure reduced to what this fixture added.
 * `as_of`, `period`, `season` and `notes` pass through untouched: they are
 * statements about the request, not counts of rows.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the summary is asserted shape by shape below
function contributed(after: Record<string, any>, before: Record<string, any>): Record<string, any> {
  return {
    ...after,
    farmers: minus(after.farmers, before.farmers),
    reach: minus(after.reach, before.reach),
    land: minus(after.land, before.land),
    by: {
      sex: minusRows(after.by.sex, before.by.sex),
      age_band: minusRows(after.by.age_band, before.by.age_band),
      state: minusRows(after.by.state, before.by.state),
      county: minusRows(after.by.county, before.by.county),
      payam: minusRows(after.by.payam, before.by.payam),
      crop: minusRows(after.by.crop, before.by.crop),
    },
  };
}

/** Ask a view now and subtract what it already said in beforeAll. */
const fixtureOnly = async (view: ViewName) => {
  const [as, query] = VIEWS[view]();
  return contributed(await summary(as, query), BASELINE[view]);
};

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
  supervisorB = await createPrincipal(prisma, 'supervisor', { stateId: STATE_B });
  readOnly = await createPrincipal(prisma, 'read_only', { stateId: STATE_A });
  officerA = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
  officerB = await createPrincipal(prisma, 'officer', { payamId: PAYAM_B });
  officerEE = await createPrincipal(prisma, 'officer', { payamId: PAYAM_EE });
});

/*
 * A SECOND HOOK, DELIBERATELY. Setting this fixture up takes minutes -- every
 * principal is a real Supabase account and every row goes through its route --
 * and the baselines are eight more round trips on top. Vitest gives each
 * beforeAll its own timeout, so the two are separated rather than raising a
 * limit that is there to catch a genuinely stuck run.
 */
beforeAll(async () => {
  // Before a single fixture row exists. Whatever staging already held is
  // recorded here and subtracted from every hand-counted figure below.
  for (const view of Object.keys(VIEWS) as ViewName[]) {
    const [as, query] = VIEWS[view]();
    BASELINE[view] = await summary(as, query);
  }
});

beforeAll(async () => {
  F.f1 = (await register(officerA, { sex: 'f', year_of_birth: 1990 })).id as string;
  F.f2 = (await register(officerB, { sex: 'm', year_of_birth: 1970, payam_id: PAYAM_B }))
    .id as string;
  F.f3 = (await register(officerA)).id as string;
  F.f4 = (await register(officerA)).id as string;
  F.f5 = (await register(officerA)).id as string;
  F.f6 = (await register(officerA)).id as string;
  F.f7 = (await register(officerEE, { payam_id: PAYAM_EE })).id as string;

  await mapFarm(officerA, F.f1!, ['maize', 'sorghum']);
  await mapFarm(officerB, F.f2!, ['maize']);
  f5Farm = await mapFarm(officerA, F.f5!, ['groundnut']);
  f6Farm = await mapFarm(officerA, F.f6!, ['maize']);

  await visit(officerA, F.f1!);
  const older = await visit(officerA, F.f1!);
  // The second visit to F1 was received last month: the monthly view sees two farmer-months; reach sees one farmer.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE public.visit DISABLE TRIGGER visit_evidence_immutable_trg`,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE public.visit SET received_at = $2::timestamptz WHERE id = $1::uuid`,
    older,
    LAST_MONTH,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE public.visit ENABLE TRIGGER visit_evidence_immutable_trg`,
  );
  await visit(officerB, F.f2!);
  await visit(officerA, F.f3!);
  f5Visit = await visit(officerA, F.f5!);
  await visit(officerA, F.f6!);

  await verify(F.f1!);
  await verify(F.f2!);
  await verify(F.f5!);
  await verify(F.f6!);
  expect(
    (
      await checked(farmerReject, 'POST', {
        as: admin,
        params: { id: F.f4! },
        body: { reason_code: 'incomplete' },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await checked(farmerMerge, 'POST', {
        as: admin,
        params: { id: F.f5! },
        body: { target_id: F.f1! },
      })
    ).status,
  ).toBe(200);
  expect((await checked(farmerItem, 'DELETE', { as: admin, params: { id: F.f6! } })).status).toBe(
    204,
  );
});
afterAll(async () => {
  await prisma
    .$executeRawUnsafe(`ALTER TABLE public.visit ENABLE TRIGGER visit_evidence_immutable_trg`)
    .catch(() => {});
  await sweep(prisma);
  await prisma.$disconnect();
});

run('the merge repoints, the removal excludes (C-10.1)', () => {
  it('F5’s farm and visit now belong to F1, each with an audit entry naming both payams; F6’s farm and visit are in no view', async () => {
    const [farm] = await prisma.$queryRawUnsafe<{ farmer_id: string }[]>(
      `SELECT farmer_id FROM public.farm WHERE id = $1::uuid`,
      f5Farm,
    );
    expect(farm?.farmer_id).toBe(F.f1);
    const [v] = await prisma.$queryRawUnsafe<{ farmer_id: string }[]>(
      `SELECT farmer_id FROM public.visit WHERE id = $1::uuid`,
      f5Visit,
    );
    expect(v?.farmer_id).toBe(F.f1);
    const repointed = await prisma.$queryRawUnsafe<
      { entity_type: string; action: string; after: Record<string, unknown> }[]
    >(
      `SELECT entity_type, action, after FROM public.audit_event WHERE entity_id IN ($1, $2) AND action IN ('farm.repointed','visit.repointed') ORDER BY entity_type`,
      f5Farm,
      f5Visit,
    );
    expect(repointed.map((r) => r.action)).toEqual(['farm.repointed', 'visit.repointed']);
    expect(repointed[0]!.after).toMatchObject({
      farmer_id: F.f1,
      farm_payam_id: PAYAM_A,
      survivor_payam_id: PAYAM_A,
    });
    // The trigger admits only a merge's move: any other change of a visit's farmer is refused.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE public.visit SET farmer_id = $2::uuid WHERE id = $1::uuid`,
        f5Visit,
        F.f2,
      ),
    ).rejects.toThrow(/visit_evidence_immutable/);
    for (const view of ['farm_active', 'farm_mapped_v']) {
      const [n] = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM public.${view} WHERE id = $1::uuid`,
        f6Farm,
      );
      expect(n?.n, view).toBe(0);
    }
    const [vis] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.visit_active v WHERE v.farmer_id = $1::uuid`,
      F.f6,
    );
    expect(vis?.n).toBe(0);
  });
});

run('the figures (C-10.2 to C-10.7)', () => {
  it('a supervisor’s summary for state CE: counted by hand from the fixture', async () => {
    const s = await fixtureOnly('ce');
    // People by status: F1, F2 verified; F3 pending; F4 rejected; F5 merged; F6 removed and absent.
    expect(s.farmers).toEqual({ verified: 2, pending: 1, rejected: 1, merged: 1 });
    // Reach: F1 (two visits, one last month — one farmer) and F2; F3 is pending, so beside.
    expect(s.reach).toEqual({ farmers_reached: 2, visits: 4, other_farmers_visited: 1 });
    // Land: F1's farm, F5's farm now F1's, F2's farm; F6's excluded. Three squares.
    expect(s.land.farms_mapped).toBe(3);
    expect(Math.abs(s.land.hectares - 3 * ONE_FARM_HA) / (3 * ONE_FARM_HA)).toBeLessThan(0.01);
    expect(s.land.farms_of_verified).toBe(3);
    // Breakdowns of verified farmers and those reached.
    expect(s.by.sex).toEqual([
      { key: 'f', verified: 1, reached: 1 },
      { key: 'm', verified: 1, reached: 1 },
    ]);
    const cutoff = new Date(s.as_of as string);
    expect(s.by.age_band).toEqual(
      [
        { key: ageBandAt(1970, cutoff), verified: 1, reached: 1 },
        { key: ageBandAt(1990, cutoff), verified: 1, reached: 1 },
      ].sort((a, b) => a.key.localeCompare(b.key)),
    );
    expect(s.by.payam).toEqual(
      [
        { key: PAYAM_B, verified: 1, reached: 1 },
        { key: PAYAM_A, verified: 1, reached: 1 },
      ].sort((a, b) => a.key.localeCompare(b.key)),
    );
    // Crop: maize F1 and F2; sorghum F1; groundnut F5's farm, now F1's. Rows sum to 4 over 2 farmers, and the note says why.
    expect(s.by.crop).toEqual([
      { key: 'groundnut', verified: 1 },
      { key: 'maize', verified: 2 },
      { key: 'sorghum', verified: 1 },
    ]);
    expect(s.notes).toEqual(expect.arrayContaining([AGE_BAND_NOTE, CROP_NOTE]));
    // The monthly view would have said two: the reach figure did not read it (C-10.2).
    const [monthly] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT coalesce(sum(verified_farmers_visited), 0)::int AS n FROM public.extension_coverage_v WHERE payam_id = $1`,
      PAYAM_A,
    );
    expect(monthly?.n).toBeGreaterThanOrEqual(2);
  });

  it('the period bounds reach by the server’s moment; a reversed period and a future cut-off are refused', async () => {
    const s = await fixtureOnly('ceRecent');
    expect(s.reach.farmers_reached).toBe(2);
    expect(s.reach.visits).toBe(3);
    const lastMonthOnly = await fixtureOnly('ceAroundLastMonth');
    expect(lastMonthOnly.reach).toEqual({
      farmers_reached: 1,
      visits: 1,
      other_farmers_visited: 0,
    });
    const reversed = await checked(reportSummary, 'GET', {
      as: supervisorA,
      query: { from: new Date().toISOString(), to: LAST_MONTH.toISOString() },
    });
    expect(reversed.status).toBe(400);
    expect(errorOf(reversed).fields?.to).toBe(REPORT_MESSAGES.periodReversed);
    const future = await checked(reportSummary, 'GET', {
      as: supervisorA,
      query: { cutoff: '2999-01-01' },
    });
    expect(future.status).toBe(400);
    expect(errorOf(future).fields?.cutoff).toBe(REPORT_MESSAGES.cutoffFuture);
  });

  it('C-10.10: an officer sees their caseload, a supervisor their state, an administrator all; a filter never widens scope', async () => {
    const mine = await fixtureOnly('caseloadA');
    expect(mine.farmers).toEqual({ verified: 1, pending: 1, rejected: 1, merged: 1 });
    expect(mine.land.farms_mapped).toBe(2); // F1's own and F5's, now F1's
    const all = await fixtureOnly('national');
    expect(all.farmers.pending).toBe(2); // F3 and F7 in EE
    const ee = await fixtureOnly('ee');
    expect(ee.farmers).toEqual({ verified: 0, pending: 1, rejected: 0, merged: 0 });
    const widened = await fixtureOnly('eeAskingForCe');
    expect(widened.farmers.verified).toBe(0);
    const ro = await fixtureOnly('readOnlyCe');
    expect(ro.farmers.verified).toBe(2);
  });
});

run('exports (C-10.8, C-10.9, C-10.11)', () => {
  it('an export is logged with who, the query as run, the filters, the cut-off and the row count; its data equals the dashboard’s', async () => {
    const filters = { season: SEASON };
    const dashboard = await summary(supervisorA, filters);
    const r = await checked(reportExports, 'POST', {
      as: supervisorA,
      body: { report_type: 'summary', filters },
    });
    expect(r.status, r.text).toBe(201);
    const { export: log, data: exported } = data(r) as {
      export: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(exported.farmers).toEqual(dashboard.farmers);
    expect(exported.reach).toEqual(dashboard.reach);
    expect(exported.by).toEqual(dashboard.by);
    expect(log.exported_by).toBe(supervisorA.id);
    expect(log.report_type).toBe('summary');
    expect(log.filters).toEqual(filters);
    expect(log.scope).toEqual({ kind: 'state', state_id: STATE_A });
    expect(log.data_cutoff).toBe(new Date().toISOString().slice(0, 10));
    expect(String(log.query)).toContain('FROM public.farmer fr');
    expect(String(log.query)).toContain(`'${STATE_A}'`);
    expect(String(log.query)).not.toMatch(/\$\d/);
    const audit = await prisma.$queryRawUnsafe<{ action: string }[]>(
      `SELECT action FROM public.audit_event WHERE entity_type = 'report_export' AND entity_id = $1`,
      log.id,
    );
    expect(audit.map((a) => a.action)).toEqual(['report.exported']);
  });

  it('the farmer list carries farmer numbers only — no name, phone or national ID key exists in it', async () => {
    const r = await checked(reportExports, 'POST', { as: admin, body: { report_type: 'farmers' } });
    expect(r.status, r.text).toBe(201);
    const { export: log, data: rows } = data(r) as {
      export: Record<string, unknown>;
      data: Record<string, unknown>[];
    };
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(log.row_count).toBe(rows.length);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'age_band',
          'county_id',
          'farmer_number',
          'payam_id',
          'reached',
          'registered_at',
          'sex',
          'state_id',
          'verification_status',
        ].sort(),
      );
    }
    expect(r.text).not.toContain(GIVEN);
    expect(r.text).not.toContain(NATIONAL_ID);
    const f1 = rows.find((x) => x.verification_status === 'verified' && x.payam_id === PAYAM_A);
    expect(f1?.reached).toBe(true);
  });

  it('who may export and who may read the log: administrators and supervisors; read-only and officers are refused; a supervisor reads their state’s log only', async () => {
    for (const who of [readOnly, officerA]) {
      expect(
        (await checked(reportExports, 'POST', { as: who, body: { report_type: 'summary' } }))
          .status,
        who.role,
      ).toBe(403);
    }
    const mine = (await checked(reportExports, 'GET', { as: supervisorA })).body.data as {
      scope: { state_id?: string };
    }[];
    expect(mine.length).toBeGreaterThanOrEqual(1);
    for (const e of mine) expect(e.scope.state_id).toBe(STATE_A);
    const theirs = (await checked(reportExports, 'GET', { as: supervisorB })).body
      .data as unknown[];
    expect(theirs).toEqual([]);
    const all = (await checked(reportExports, 'GET', { as: admin })).body.data as unknown[];
    expect(all.length).toBeGreaterThanOrEqual(mine.length + 1);
    const bad = await checked(reportExports, 'POST', { as: admin, body: { report_type: 'sms' } });
    expect(bad.status).toBe(400);
    expect(errorOf(bad).fields?.report_type).toBe(REPORT_MESSAGES.reportTypeUnknown);
  });
});
