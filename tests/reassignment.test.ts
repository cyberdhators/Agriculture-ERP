import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as farmerFarms from '../apps/web/app/api/farmers/[id]/farms/route';
import * as farmerReassign from '../apps/web/app/api/farmers/[id]/reassign/route';
import * as farmerReject from '../apps/web/app/api/farmers/[id]/reject/route';
import * as farmerResubmit from '../apps/web/app/api/farmers/[id]/resubmit/route';
import * as farmerItem from '../apps/web/app/api/farmers/[id]/route';
import * as farmerVisits from '../apps/web/app/api/farmers/[id]/visits/route';
import * as farmers from '../apps/web/app/api/farmers/route';
import * as farmBoundaries from '../apps/web/app/api/farms/[id]/boundaries/route';
import * as farmItem from '../apps/web/app/api/farms/[id]/route';
import * as officerItem from '../apps/web/app/api/officers/[id]/route';
import * as visitItem from '../apps/web/app/api/visits/[id]/route';
import { RULE_MESSAGES } from '../apps/web/lib/api/errors';
import { makeTestPrisma, requireTestEnv } from './helpers/db';
import {
  FARMER_TEST_FAMILY,
  TEST_LOCATION_PREFIX,
  type TestPrincipal,
  createPrincipal,
  sweep,
} from './helpers/principals';
import { ADVICE, NATIONAL_ID, checked, data, errorOf } from './helpers/scan';

/**
 * B8.5 — caseload reassignment (C-8R). registered_by is history; the
 * caseload pointer is what every scope check reads. Farms and visits follow
 * the farmer without being touched.
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
let officerA2: TestPrincipal & { password: string };
let officerB: TestPrincipal & { password: string };
let officerEE: TestPrincipal & { password: string };

let phoneSeq = 8_000_000;
const farmerBody = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  given_name: 'Zzreassign',
  family_name: FARMER_TEST_FAMILY,
  sex: 'm',
  year_of_birth: 1975,
  phone: `+21192${String(1_000_000 + (phoneSeq += 1)).padStart(7, '0')}`,
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
const SQUARE = {
  type: 'Polygon',
  coordinates: [
    [
      [31.6, 4.85],
      [31.6009, 4.85],
      [31.6009, 4.8509],
      [31.6, 4.8509],
      [31.6, 4.85],
    ],
  ],
};
const mapFarm = async (as: TestPrincipal, farmerId: string) => {
  const r = await checked(farmerFarms, 'POST', {
    as,
    params: { id: farmerId },
    body: { id: randomUUID(), season: '2026-main', boundary: SQUARE, gps_accuracy_m: 6 },
  });
  expect(r.status, `setup farm: ${r.text}`).toBe(201);
  return data(r).id as string;
};
const visit = async (as: TestPrincipal, farmerId: string) => {
  const r = await checked(farmerVisits, 'POST', {
    as,
    params: { id: farmerId },
    body: {
      id: randomUUID(),
      visited_at: new Date(Date.now() - 3_600_000).toISOString(),
      position: { type: 'Point', coordinates: [31.6004, 4.8503] },
      gps_accuracy_m: 6,
      advice: ADVICE,
      topics: ['weeding'],
    },
  });
  expect(r.status, `setup visit: ${r.text}`).toBe(201);
  return data(r).id as string;
};
const reassign = (as: TestPrincipal, farmerId: string, officerId: string) =>
  checked(farmerReassign, 'POST', {
    as,
    params: { id: farmerId },
    body: { officer_id: officerId },
  });

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
  officerA2 = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
  officerB = await createPrincipal(prisma, 'officer', { payamId: PAYAM_B });
  officerEE = await createPrincipal(prisma, 'officer', { payamId: PAYAM_EE });
});
afterAll(async () => {
  await sweep(prisma);
  await prisma.$disconnect();
});

run('the pointer (C-8R.1, C-8R.6)', () => {
  it('a new farmer carries both officers, equal', async () => {
    const f = await register(officerA);
    expect(f.registered_by).toBe(officerA.id);
    expect(f.caseload_officer_id).toBe(officerA.id);
    const [row] = await prisma.$queryRawUnsafe<{ same: boolean }[]>(
      `SELECT registered_by = caseload_officer_id AS same FROM public.farmer WHERE id = $1::uuid`,
      f.id,
    );
    expect(row?.same).toBe(true);
  });
});

run('who reassigns, and to whom (C-8R.2)', () => {
  it('an administrator reassigns to an active officer in the farmer’s payam; supervisor, read-only and officers are refused; the same officer, another payam, an inactive officer and a stranger are 422 with one sentence', async () => {
    const f = await register(officerA);
    for (const who of [supervisorA, readOnly, officerA, officerA2]) {
      expect((await reassign(who, f.id as string, officerA2.id)).status, who.role).toBe(403);
    }
    const same = await reassign(admin, f.id as string, officerA.id);
    expect(same.status).toBe(422);
    expect(errorOf(same).message).toBe(RULE_MESSAGES.reassign_same_officer);
    for (const [label, target] of [
      ['another payam', officerB.id],
      ['another state', officerEE.id],
      ['no such officer', randomUUID()],
    ] as const) {
      const r = await reassign(admin, f.id as string, target);
      expect(r.status, label).toBe(422);
      expect(errorOf(r).message, label).toBe(RULE_MESSAGES.reassign_officer_not_found);
    }
    const inactive = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
    await prisma.$executeRawUnsafe(
      `UPDATE public.officer SET status = 'inactive' WHERE id = $1::uuid`,
      inactive.id,
    );
    const toInactive = await reassign(admin, f.id as string, inactive.id);
    expect(toInactive.status).toBe(422);
    expect(errorOf(toInactive).message).toBe(RULE_MESSAGES.reassign_officer_not_found);

    const moved = await reassign(admin, f.id as string, officerA2.id);
    expect(moved.status, moved.text).toBe(200);
    expect(data(moved).caseload_officer_id).toBe(officerA2.id);
    expect(data(moved).registered_by, 'registered_by is history').toBe(officerA.id);

    const rows = await prisma.$queryRawUnsafe<
      { action: string; before: unknown; after: unknown }[]
    >(
      `SELECT action, before, after FROM public.audit_event WHERE entity_type = 'farmer' AND entity_id = $1 AND action = 'farmer.reassigned'`,
      f.id,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.before).toEqual({ caseload_officer_id: officerA.id });
    expect(rows[0]!.after).toEqual({ caseload_officer_id: officerA2.id });
    // The refused no-op left no row: the log never says a move happened that did not.
    const [count] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.audit_event WHERE entity_type = 'farmer' AND entity_id = $1 AND action = 'farmer.reassigned'`,
      f.id,
    );
    expect(count?.n).toBe(1);
  });
});

run('everything follows the farmer (C-8R.3, C-8R.4, C-8R.7)', () => {
  it('after reassignment the new officer reads, maps, visits and resubmits; the old officer gets 404 on all of it; farms and visits were not touched', async () => {
    const f = await register(officerA);
    const farmId = await mapFarm(officerA, f.id as string);
    const visitId = await visit(officerA, f.id as string);
    // Rejected, so resubmission is on the table (C-6.5).
    expect(
      (
        await checked(farmerReject, 'POST', {
          as: admin,
          params: { id: f.id as string },
          body: { reason_code: 'incomplete' },
        })
      ).status,
    ).toBe(200);
    const before = await prisma.$queryRawUnsafe<{ updated_at: Date }[]>(
      `SELECT updated_at FROM public.farm WHERE id = $1::uuid UNION ALL SELECT updated_at FROM public.visit WHERE id = $2::uuid`,
      farmId,
      visitId,
    );

    expect((await reassign(admin, f.id as string, officerA2.id)).status).toBe(200);

    // The old officer: not found, everywhere.
    for (const [label, r] of [
      [
        'farmer',
        await checked(farmerItem, 'GET', { as: officerA, params: { id: f.id as string } }),
      ],
      ['farm', await checked(farmItem, 'GET', { as: officerA, params: { id: farmId } })],
      ['visit', await checked(visitItem, 'GET', { as: officerA, params: { id: visitId } })],
      [
        'resubmit',
        await checked(farmerResubmit, 'POST', { as: officerA, params: { id: f.id as string } }),
      ],
      [
        'map',
        await checked(farmBoundaries, 'POST', {
          as: officerA,
          params: { id: farmId },
          body: { season: '2026-second', boundary: SQUARE, gps_accuracy_m: 6 },
        }),
      ],
    ] as const) {
      expect(r.status, `old officer, ${label}`).toBe(404);
    }
    const oldList = (await checked(farmers, 'GET', { as: officerA })).body.data as { id: string }[];
    expect(oldList.map((x) => x.id)).not.toContain(f.id);

    // The new officer: everything, including the national ID (C-5.8 read as the caseload officer).
    const asNew = await checked(farmerItem, 'GET', {
      as: officerA2,
      params: { id: f.id as string },
    });
    expect(asNew.status).toBe(200);
    expect(data(asNew).national_id).toBe(NATIONAL_ID);
    expect((await checked(farmItem, 'GET', { as: officerA2, params: { id: farmId } })).status).toBe(
      200,
    );
    expect(
      (await checked(visitItem, 'GET', { as: officerA2, params: { id: visitId } })).status,
    ).toBe(200);
    expect(
      (
        await checked(farmBoundaries, 'POST', {
          as: officerA2,
          params: { id: farmId },
          body: { season: '2026-second', boundary: SQUARE, gps_accuracy_m: 6 },
        })
      ).status,
    ).toBe(201);
    await visit(officerA2, f.id as string);
    expect(
      (await checked(farmerResubmit, 'POST', { as: officerA2, params: { id: f.id as string } }))
        .status,
    ).toBe(200);
    // The old officer's visit is still the old officer's: the record of who went is history too.
    const oldVisit = data(
      await checked(visitItem, 'GET', { as: officerA2, params: { id: visitId } }),
    );
    expect(oldVisit.officer_id).toBe(officerA.id);
    expect(
      oldVisit,
      'position is the visiting officer’s and the admin’s, not the caseload’s',
    ).not.toHaveProperty('position');

    const after = await prisma.$queryRawUnsafe<{ updated_at: Date }[]>(
      `SELECT updated_at FROM public.farm WHERE id = $1::uuid UNION ALL SELECT updated_at FROM public.visit WHERE id = $2::uuid`,
      farmId,
      visitId,
    );
    expect(after.map((r) => r.updated_at.getTime())).toEqual(
      before.map((r) => r.updated_at.getTime()),
    );
  });

  it('a supervisor’s and an administrator’s view does not change: the farmer is in the same state either way', async () => {
    const f = await register(officerA);
    expect((await reassign(admin, f.id as string, officerA2.id)).status).toBe(200);
    for (const who of [supervisorA, readOnly, admin]) {
      const r = await checked(farmerItem, 'GET', { as: who, params: { id: f.id as string } });
      expect(r.status, who.role).toBe(200);
      expect(data(r).caseload_officer_id).toBe(officerA2.id);
    }
  });
});

run('deactivation says how many (C-8R.3 addition)', () => {
  it('setting an officer inactive answers with the number of farmers now without a working officer; nothing is refused', async () => {
    const leaving = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
    const a = await register(leaving);
    const b = await register(leaving);
    const gone = await register(leaving);
    expect(
      (await checked(farmerItem, 'DELETE', { as: admin, params: { id: gone.id as string } }))
        .status,
    ).toBe(204);
    const r = await checked(officerItem, 'PATCH', {
      as: admin,
      params: { id: leaving.id },
      body: { status: 'inactive' },
    });
    expect(r.status, r.text).toBe(200);
    expect(data(r).unassigned_farmers, 'the removed farmer is not counted').toBe(2);
    // Reactivating does not carry the number: nothing became unassigned.
    const back = await checked(officerItem, 'PATCH', {
      as: admin,
      params: { id: leaving.id },
      body: { status: 'active' },
    });
    expect(back.status).toBe(200);
    expect(data(back)).not.toHaveProperty('unassigned_farmers');
    // And the frozen farmers thaw the ordinary way.
    expect((await reassign(admin, a.id as string, officerA2.id)).status).toBe(200);
    expect((await reassign(admin, b.id as string, officerA2.id)).status).toBe(200);
  });
});
