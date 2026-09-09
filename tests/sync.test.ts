import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as farmerFarms from '../apps/web/app/api/farmers/[id]/farms/route';
import * as farmerReassign from '../apps/web/app/api/farmers/[id]/reassign/route';
import * as farmerItem from '../apps/web/app/api/farmers/[id]/route';
import * as farmerVerify from '../apps/web/app/api/farmers/[id]/verify/route';
import * as farmerVisits from '../apps/web/app/api/farmers/[id]/visits/route';
import * as farmers from '../apps/web/app/api/farmers/route';
import * as farmBoundaries from '../apps/web/app/api/farms/[id]/boundaries/route';
import * as farmsList from '../apps/web/app/api/farms/route';
import * as caseload from '../apps/web/app/api/sync/caseload/route';
import * as visitAttachments from '../apps/web/app/api/visits/[id]/attachments/route';
import * as attachmentConfirm from '../apps/web/app/api/visits/[id]/attachments/[aid]/confirm/route';
import * as visitItem from '../apps/web/app/api/visits/[id]/route';
import * as visits from '../apps/web/app/api/visits/route';
import { RULE_MESSAGES, authUnavailable, internalError } from '../apps/web/lib/api/errors';
import { DEVICE_ID_HEADER, SYNC_MESSAGES, SYNC_OUTCOME_SPECS } from '../packages/shared/src/sync';
import { makeTestPrisma, requireTestEnv } from './helpers/db';
import {
  FARMER_TEST_FAMILY,
  TEST_LOCATION_PREFIX,
  type TestPrincipal,
  createPrincipal,
  sweep,
} from './helpers/principals';
import { ADVICE, checked, data, errorOf } from './helpers/scan';

/**
 * B9 — the server side of offline sync (C-9). What the officer app is built
 * against: true idempotency on every create, the client id on boundaries, the
 * device header on every audit row, Retry-After on the retryable outcomes, the
 * download filter and the caseload endpoint, captured-at.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });
requireTestEnv();
const run = describe;
const prisma = makeTestPrisma();

const STATE_A = 'CE';
const STATE_B = 'EE';
const PAYAM_A = 'CE-JUB-MUN';
const COUNTY_EE = TEST_LOCATION_PREFIX;
const PAYAM_EE = `${TEST_LOCATION_PREFIX}-TST`;
const DEVICE = 'zztest-device-0001';

let admin: TestPrincipal & { password: string };
let supervisorA: TestPrincipal & { password: string };
let officerA: TestPrincipal & { password: string };
let officerA2: TestPrincipal & { password: string };

let phoneSeq = 5_500_000;
const MONDAY = '2026-08-31T09:15:00+02:00';
const farmerBody = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  given_name: 'Zzsync',
  family_name: FARMER_TEST_FAMILY,
  sex: 'f',
  year_of_birth: 1988,
  phone: `+21193${String(1_000_000 + (phoneSeq += 1)).padStart(7, '0')}`,
  payam_id: PAYAM_A,
  consent: { text_version: 'v1.0-en', language: 'en', granted: true },
  captured_at: MONDAY,
  ...overrides,
});
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
const farmBody = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  boundary_id: randomUUID(),
  season: '2026-main',
  boundary: SQUARE,
  gps_accuracy_m: 6,
  captured_at: MONDAY,
  ...overrides,
});
const visitBody = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  visited_at: MONDAY,
  position: { type: 'Point', coordinates: [31.6004, 4.8503] },
  gps_accuracy_m: 6,
  advice: ADVICE,
  topics: ['weeding'],
  ...overrides,
});
const fromDevice = { [DEVICE_ID_HEADER]: DEVICE };
const post = (mod: Parameters<typeof checked>[0], as: TestPrincipal, body: unknown, id?: string) =>
  checked(mod, 'POST', { as, body, headers: fromDevice, ...(id ? { params: { id } } : {}) });
const register = async (as: TestPrincipal, overrides: Record<string, unknown> = {}) => {
  const r = await post(farmers, as, farmerBody(overrides));
  expect(r.status, `setup registration: ${r.text}`).toBe(201);
  return data(r);
};
const auditRows = (entity: string, id: string) =>
  prisma.$queryRawUnsafe<{ action: string; device_id: string | null }[]>(
    `SELECT action, device_id FROM public.audit_event WHERE entity_type = $1 AND entity_id = $2 ORDER BY occurred_at, id`,
    entity,
    id,
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
  officerA = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
  officerA2 = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
});
afterAll(async () => {
  await sweep(prisma);
  await prisma.$disconnect();
});

run('true idempotency (C-9.1, C-9.2, C-9.3)', () => {
  it('a farmer sent twice is one row, one audit entry and a 200 the second time; the same id with other details is 409', async () => {
    const sent = farmerBody();
    const first = await post(farmers, officerA, sent);
    expect(first.status).toBe(201);
    const again = await post(farmers, officerA, sent);
    expect(again.status, again.text).toBe(200);
    expect(data(again).id).toBe(sent.id);
    expect(data(again).farmer_number).toBe(data(first).farmer_number);
    const other = await post(farmers, officerA, { ...sent, given_name: 'Zzelse' });
    expect(other.status).toBe(409);
    expect(errorOf(other).message).toBe(RULE_MESSAGES.farmer_already_exists);
    const rows = await auditRows('farmer', sent.id as string);
    expect(rows.filter((r) => r.action === 'farmer.created')).toHaveLength(1);
    // Another officer sending the same body is a conflict, not a read of a stranger's record.
    const stranger = await post(farmers, officerA2, sent);
    expect(stranger.status).toBe(409);
  });

  it('a farm sent twice is one farm and one boundary; a boundary sent twice is never a second boundary nor a supersession', async () => {
    const f = await register(officerA);
    const sent = farmBody();
    const first = await post(farmerFarms, officerA, sent, f.id as string);
    expect(first.status, first.text).toBe(201);
    const again = await post(farmerFarms, officerA, sent, f.id as string);
    expect(again.status, again.text).toBe(200);
    expect(data(again).id).toBe(sent.id);
    const differs = await post(
      farmerFarms,
      officerA,
      { ...sent, season: '2026-second' },
      f.id as string,
    );
    expect(differs.status).toBe(409);
    expect(errorOf(differs).message).toBe(RULE_MESSAGES.farm_already_exists);

    // The remap that lost its acknowledgement: sent twice, one row, still current, nothing superseded.
    const remap = { id: randomUUID(), season: '2026-second', boundary: SQUARE, gps_accuracy_m: 7 };
    const r1 = await post(farmBoundaries, officerA, remap, sent.id as string);
    expect(r1.status).toBe(201);
    const r2 = await post(farmBoundaries, officerA, remap, sent.id as string);
    expect(r2.status, r2.text).toBe(200);
    expect(data(r2).id).toBe(remap.id);
    expect(data(r2).superseded).toBeNull();
    const history = await prisma.$queryRawUnsafe<{ id: string; is_current: boolean }[]>(
      `SELECT id, is_current FROM public.farm_boundary WHERE farm_id = $1::uuid ORDER BY mapped_at`,
      sent.id,
    );
    expect(history).toHaveLength(2);
    expect(history.filter((h) => h.is_current)).toHaveLength(2); // two seasons, one current each
    const actions = (await auditRows('farm', sent.id as string)).map((r) => r.action);
    expect(actions.filter((a) => a === 'farm.boundary_superseded')).toHaveLength(0);
    expect(actions.filter((a) => a === 'farm.boundary_added')).toHaveLength(2);

    // The same boundary id with another ring, or on another farm, is a conflict.
    const changed = await post(
      farmBoundaries,
      officerA,
      { ...remap, gps_accuracy_m: 9 },
      sent.id as string,
    );
    expect(changed.status).toBe(409);
    expect(errorOf(changed).message).toBe(RULE_MESSAGES.boundary_already_exists);
    const otherFarm = await post(
      farmerFarms,
      officerA,
      farmBody({ boundary_id: remap.id }),
      f.id as string,
    );
    expect(otherFarm.status).toBe(409);
    expect(errorOf(otherFarm).message).toBe(RULE_MESSAGES.boundary_already_exists);
    // The id is required at the door: a body without one is refused before anything is written.
    const noId = await post(
      farmBoundaries,
      officerA,
      { season: '2027-main', boundary: SQUARE, gps_accuracy_m: 6 },
      sent.id as string,
    );
    expect(noId.status).toBe(400);
    expect(errorOf(noId).fields?.id).toBeDefined();
  });
});

run('the device on every audit row (C-9.8)', () => {
  it('a request from a device stamps every audit entry it writes; a browser leaves null; a malformed header is 400 naming the header', async () => {
    const f = await register(officerA);
    const farm = await post(farmerFarms, officerA, farmBody(), f.id as string);
    const visit = await post(farmerVisits, officerA, visitBody(), f.id as string);
    for (const [entity, id] of [
      ['farmer', f.id],
      ['consent', (f.consent as { id: string }).id],
      ['farm', data(farm).id],
      ['visit', data(visit).id],
    ] as const) {
      const rows = await auditRows(entity, id as string);
      expect(rows.length, entity).toBeGreaterThan(0);
      for (const r of rows) expect(r.device_id, `${entity} ${r.action}`).toBe(DEVICE);
    }
    // The web portal: no header, null device, as every row before B9.
    const verified = await checked(farmerVerify, 'POST', {
      as: supervisorA,
      params: { id: f.id as string },
      body: {},
    });
    expect(verified.status).toBe(200);
    const after = await auditRows('farmer', f.id as string);
    expect(after[after.length - 1]).toMatchObject({ action: 'farmer.verified', device_id: null });

    const bad = await checked(farmers, 'POST', {
      as: officerA,
      body: farmerBody(),
      headers: { [DEVICE_ID_HEADER]: 'no spaces allowed here!' },
    });
    expect(bad.status).toBe(400);
    expect(errorOf(bad).fields?.[DEVICE_ID_HEADER]).toBe(SYNC_MESSAGES.deviceIdShape);
  });
});

run('the device acts without a follow-up read (C-9.4, C-9.15)', () => {
  it('the retryable outcomes carry Retry-After from the contract; a refusal carries its sentence; a conflict names nothing but the identifier’s fate', async () => {
    expect(authUnavailable().headers?.['retry-after']).toBe(
      String(SYNC_OUTCOME_SPECS.retry_later.retryAfterSeconds),
    );
    expect(internalError().headers?.['retry-after']).toBe(
      String(SYNC_OUTCOME_SPECS.retry_later.retryAfterSeconds),
    );
    const f = await register(officerA);
    const visit = data(await post(farmerVisits, officerA, visitBody(), f.id as string));
    const declared = data(
      await post(
        visitAttachments,
        officerA,
        {
          id: randomUUID(),
          kind: 'photo',
          content_type: 'image/jpeg',
          byte_size: 1234,
          captured_at: MONDAY,
        },
        visit.id as string,
      ),
    );
    const early = await checked(attachmentConfirm, 'POST', {
      as: officerA,
      params: { id: visit.id as string, aid: declared.id as string },
      body: {},
      headers: fromDevice,
    });
    expect(early.status).toBe(409);
    expect(early.headers.get('retry-after')).toBe(
      String(SYNC_OUTCOME_SPECS.not_yet.retryAfterSeconds),
    );
    // A terminal conflict carries no Retry-After: the device must not retry it.
    const dup = await post(farmers, officerA, {
      ...farmerBody({ id: f.id }),
      given_name: 'Zzother',
    });
    expect(dup.status).toBe(409);
    expect(dup.headers.get('retry-after')).toBeNull();
  });
});

run('download (C-9.9) and captured-at (C-9.10)', () => {
  it('updated_since sees a verification decision, a correction and a reassignment; the caseload endpoint tells the device what has left', async () => {
    const before = data(await checked(caseload, 'GET', { as: officerA, headers: fromDevice }));
    expect(before).toHaveProperty('as_of');
    const stays = await register(officerA);
    const leaves = await register(officerA);
    const farm = data(await post(farmerFarms, officerA, farmBody(), stays.id as string));
    const visit = data(await post(farmerVisits, officerA, visitBody(), stays.id as string));
    const mark = data(await checked(caseload, 'GET', { as: officerA, headers: fromDevice }));
    expect(mark.farmers).toEqual(expect.arrayContaining([stays.id, leaves.id]));
    expect(mark.farms).toContain(farm.id);
    expect(mark.visits).toContain(visit.id);

    // Nothing has changed since the mark: the lists are empty for it.
    const since = { updated_since: mark.as_of as string };
    const quiet = await checked(farmers, 'GET', { as: officerA, query: since });
    expect((quiet.body.data as { id: string }[]).map((x) => x.id)).not.toContain(stays.id);

    // A verification decision on the web changes the farmer's server moment; the device sees it.
    expect(
      (
        await checked(farmerVerify, 'POST', {
          as: supervisorA,
          params: { id: stays.id as string },
          body: {},
        })
      ).status,
    ).toBe(200);
    const changed = await checked(farmers, 'GET', { as: officerA, query: since });
    const ids = changed.body.data as { id: string; verification_status: string }[];
    expect(ids.map((x) => x.id)).toContain(stays.id);
    expect(ids.map((x) => x.id)).not.toContain(leaves.id);
    expect(ids.find((x) => x.id === stays.id)?.verification_status).toBe('verified');

    // A correction by an administrator changes the visit's moment; the farm list has the filter too.
    expect(
      (
        await checked(visitItem, 'PATCH', {
          as: admin,
          params: { id: visit.id as string },
          body: { topics: ['weeding', 'harvest'] },
        })
      ).status,
    ).toBe(200);
    const visitsChanged = await checked(visits, 'GET', { as: officerA, query: since });
    expect((visitsChanged.body.data as { id: string }[]).map((x) => x.id)).toContain(visit.id);
    const farmsQuiet = await checked(farmsList, 'GET', { as: officerA, query: since });
    expect(farmsQuiet.status).toBe(200);
    expect((farmsQuiet.body.data as { id: string }[]).map((x) => x.id)).not.toContain(farm.id);
    const farmsAll = await checked(farmsList, 'GET', { as: officerA });
    expect((farmsAll.body.data as { id: string }[]).map((x) => x.id)).toContain(farm.id);
    const badSince = await checked(farmsList, 'GET', {
      as: officerA,
      query: { updated_since: 'monday' },
    });
    expect(badSince.status).toBe(400);

    // Reassigned while the phone was away: gone from the caseload, gone from the lists, 404 on the record.
    expect(
      (
        await checked(farmerReassign, 'POST', {
          as: admin,
          params: { id: leaves.id as string },
          body: { officer_id: officerA2.id },
        })
      ).status,
    ).toBe(200);
    const afterwards = data(await checked(caseload, 'GET', { as: officerA, headers: fromDevice }));
    expect(afterwards.farmers).toContain(stays.id);
    expect(afterwards.farmers).not.toContain(leaves.id);
    const gone = await checked(farmerItem, 'GET', {
      as: officerA,
      params: { id: leaves.id as string },
    });
    expect(gone.status).toBe(404);
    // A queued visit for that farmer meets the same 404: left_caseload, keep and show, never retry.
    const stuck = await post(farmerVisits, officerA, visitBody(), leaves.id as string);
    expect(stuck.status).toBe(404);
    // The caseload is the officer's; a supervisor has none.
    expect((await checked(caseload, 'GET', { as: supervisorA })).status).toBe(403);
  });

  it('a farmer and a farm carry the device’s moment beside the server’s; without one they read "not recorded"', async () => {
    const f = await register(officerA);
    expect(new Date(f.captured_at as string).getTime()).toBe(new Date(MONDAY).getTime());
    expect(new Date(f.created_at as string).getTime()).toBeGreaterThan(new Date(MONDAY).getTime());
    const farm = data(await post(farmerFarms, officerA, farmBody(), f.id as string));
    expect(new Date(farm.captured_at as string).getTime()).toBe(new Date(MONDAY).getTime());
    const bare = await register(officerA, { captured_at: undefined });
    expect(bare.captured_at).toBeNull();
    const [row] = await prisma.$queryRawUnsafe<{ same: boolean }[]>(
      `SELECT updated_at = created_at AS same FROM public.farmer WHERE id = $1::uuid`,
      f.id,
    );
    expect(row?.same).toBe(true);
    await prisma.$executeRawUnsafe(
      `UPDATE public.farmer SET duplicate_flag = duplicate_flag WHERE id = $1::uuid`,
      f.id,
    );
    const [bumped] = await prisma.$queryRawUnsafe<{ moved: boolean }[]>(
      `SELECT updated_at > created_at AS moved FROM public.farmer WHERE id = $1::uuid`,
      f.id,
    );
    expect(bumped?.moved, 'the trigger keeps updated_at current for any writer').toBe(true);
  });
});
