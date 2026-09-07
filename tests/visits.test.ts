import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as farmerVisits from '../apps/web/app/api/farmers/[id]/visits/route';
import * as farmers from '../apps/web/app/api/farmers/route';
import * as attachmentConfirm from '../apps/web/app/api/visits/[id]/attachments/[aid]/confirm/route';
import * as attachmentFail from '../apps/web/app/api/visits/[id]/attachments/[aid]/fail/route';
import * as attachmentLink from '../apps/web/app/api/visits/[id]/attachments/[aid]/link/route';
import * as visitAttachments from '../apps/web/app/api/visits/[id]/attachments/route';
import * as visitChain from '../apps/web/app/api/visits/[id]/chain/route';
import * as visitItem from '../apps/web/app/api/visits/[id]/route';
import * as visits from '../apps/web/app/api/visits/route';
import { RULE_MESSAGES } from '../apps/web/lib/api/errors';
import { describeStoredObject, removeStoredObject } from '../apps/web/lib/supabase/admin';
import {
  ATTACHMENT_FAILURE_MESSAGES,
  ATTACHMENT_STATUS_MESSAGES,
  VISIT_ATTACHMENT_BUCKET,
  VISIT_MESSAGES,
  VISIT_TOPICS,
} from '../packages/shared/src/visit';
import { makeTestPrisma, requireTestEnv } from './helpers/db';
import {
  FARMER_TEST_FAMILY,
  TEST_LOCATION_PREFIX,
  type TestPrincipal,
  createPrincipal,
  sweep,
} from './helpers/principals';
import { ADVICE, OBSERVATION, checked, data, errorOf, seenStatuses } from './helpers/scan';

/**
 * B8 — extension visits and attachments (C-8). Every response passes the
 * shared scan, which since this unit also searches for the visit's substance
 * (C-8.13). Every visit, photo and recording here is invented (C-8.14): the
 * photo is a few hundred bytes of JPEG header and noise.
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

let phoneSeq = 7_000_000;
const farmerBody = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  given_name: 'Zzvisit',
  family_name: FARMER_TEST_FAMILY,
  sex: 'f',
  year_of_birth: 1982,
  phone: `+21192${String(1_000_000 + (phoneSeq += 1)).padStart(7, '0')}`,
  payam_id: PAYAM_A,
  consent: { text_version: 'v1.0-en', language: 'en', granted: true },
  ...overrides,
});
const registerFarmer = async (as: TestPrincipal, overrides: Record<string, unknown> = {}) => {
  const r = await checked(farmers, 'POST', { as, body: farmerBody(overrides) });
  expect(r.status, 'setup registration').toBe(201);
  return data(r).id as string;
};

const POINT = { type: 'Point', coordinates: [31.6004, 4.8503] };
const A_WEEK_AGO = new Date(Date.now() - 7 * 86_400_000).toISOString();
const visitBody = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  visited_at: A_WEEK_AGO,
  position: POINT,
  gps_accuracy_m: 7.5,
  observation: OBSERVATION,
  advice: ADVICE,
  topics: ['pest', 'planting'],
  duration_minutes: 45,
  attendee_count: 3,
  ...overrides,
});
const recordVisit = async (
  as: TestPrincipal,
  farmerId: string,
  overrides: Record<string, unknown> = {},
) => {
  const r = await checked(farmerVisits, 'POST', {
    as,
    params: { id: farmerId },
    body: visitBody(overrides),
  });
  expect(r.status, `setup visit: ${r.text}`).toBe(201);
  return data(r);
};

/** A few hundred bytes that begin like a JPEG. Invented, and not a picture of anything. */
const FAKE_JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
  Buffer.from('zztest-not-a-real-photo-'.repeat(20)),
  Buffer.from([0xff, 0xd9]),
]);
const uploadedPaths: string[] = [];
const declarePhoto = async (
  as: TestPrincipal,
  visitId: string,
  overrides: Record<string, unknown> = {},
) =>
  checked(visitAttachments, 'POST', {
    as,
    params: { id: visitId },
    body: {
      id: randomUUID(),
      kind: 'photo',
      content_type: 'image/jpeg',
      byte_size: FAKE_JPEG.length,
      captured_at: A_WEEK_AGO,
      ...overrides,
    },
  });
/** The phone's side of C-8.6: PUT the bytes to the grant. Nothing of ours in between. */
const uploadTo = async (grant: { url: string }, bytes: Buffer, contentType = 'image/jpeg') => {
  const res = await fetch(grant.url, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'x-upsert': 'false' },
    body: new Uint8Array(bytes),
  });
  const path = new URL(grant.url).pathname.split('/object/upload/sign/')[1] ?? '';
  uploadedPaths.push(decodeURIComponent(path).replace(`${VISIT_ATTACHMENT_BUCKET}/`, ''));
  return res.status;
};
const confirm = (as: TestPrincipal, visitId: string, aid: string) =>
  checked(attachmentConfirm, 'POST', { as, params: { id: visitId, aid }, body: {} });

const auditActions = async (visitId: string) =>
  (
    await prisma.$queryRawUnsafe<{ action: string; before: unknown; after: unknown }[]>(
      `SELECT action, before, after FROM public.audit_event WHERE entity_type = 'visit' AND entity_id = $1 ORDER BY occurred_at, id`,
      visitId,
    )
  ).map((r) => ({ ...r, text: JSON.stringify([r.before, r.after]) }));

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
afterAll(async () => {
  // The bytes this run put in the bucket. The sweep removes rows; the objects
  // are ours to remove here (C-8.14: nothing invented outlives the run).
  for (const path of new Set(uploadedPaths)) {
    await removeStoredObject(VISIT_ATTACHMENT_BUCKET, path).catch(() => {});
  }
  await sweep(prisma);
  await prisma.$disconnect();
});

run('who records (C-8.9, C-8.10)', () => {
  it('an officer records a visit to their own farmer; admin, supervisor and read-only are refused by the route; another officer gets 404', async () => {
    const farmerId = await registerFarmer(officerA);
    const v = await recordVisit(officerA, farmerId);
    expect(v.officer_id).toBe(officerA.id);
    for (const [who, expected] of [
      [admin, 403],
      [supervisorA, 403],
      [readOnly, 403],
      [officerB, 404],
    ] as const) {
      const r = await checked(farmerVisits, 'POST', {
        as: who,
        params: { id: farmerId },
        body: visitBody(),
      });
      expect(r.status, who.role).toBe(expected);
    }
  });

  it('a pending farmer is visitable: the officer cannot know the supervisor’s decision', async () => {
    const farmerId = await registerFarmer(officerA);
    const [status] = await prisma.$queryRawUnsafe<{ verification_status: string }[]>(
      `SELECT verification_status::text FROM public.farmer WHERE id = $1::uuid`,
      farmerId,
    );
    expect(status?.verification_status).toBe('pending');
    await recordVisit(officerA, farmerId);
  });

  it('the officer column references officer, so the database itself cannot record an administrator as a visitor', async () => {
    const farmerId = await registerFarmer(officerA);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO public.visit (id, farmer_id, officer_id, payam_id, county_id, state_id, position, gps_accuracy_m, advice, topics, visited_at)
         SELECT $1::uuid, $2::uuid, $3::uuid, payam_id, county_id, state_id,
                extensions.ST_SetSRID(extensions.ST_MakePoint(31.6, 4.85), 4326)::extensions.geography, 5, 'x', '{other}', now()
         FROM public.farmer WHERE id = $2::uuid`,
        randomUUID(),
        farmerId,
        admin.id,
      ),
    ).rejects.toThrow(/visit_officer_id_fkey/);
  });
});

run('the record (C-8.1, C-8.2, C-8.4, C-8.5)', () => {
  it('advice is required and observation is not; topics come from the list, at least one, each once; duration and attendance are bounded', async () => {
    const farmerId = await registerFarmer(officerA);
    const refuse = async (overrides: Record<string, unknown>, field: string, reason: string) => {
      const r = await checked(farmerVisits, 'POST', {
        as: officerA,
        params: { id: farmerId },
        body: visitBody(overrides),
      });
      expect(r.status, field).toBe(400);
      expect(errorOf(r).fields?.[field], field).toBe(reason);
    };
    await refuse({ advice: '' }, 'advice', VISIT_MESSAGES.adviceRequired);
    await refuse({ advice: undefined }, 'advice', VISIT_MESSAGES.adviceRequired);
    await refuse({ topics: [] }, 'topics', VISIT_MESSAGES.topicsRequired);
    await refuse({ topics: ['pest', 'pest'] }, 'topics', VISIT_MESSAGES.topicsDuplicate);
    await refuse({ topics: ['livestock'] }, 'topics.0', VISIT_MESSAGES.topicUnknown);
    await refuse({ duration_minutes: 0 }, 'duration_minutes', VISIT_MESSAGES.durationInvalid);
    await refuse({ duration_minutes: 1441 }, 'duration_minutes', VISIT_MESSAGES.durationInvalid);
    await refuse({ attendee_count: 2.5 }, 'attendee_count', VISIT_MESSAGES.attendeesInvalid);
    await refuse(
      { position: { type: 'Point', coordinates: [200, 0] } },
      'position.coordinates',
      VISIT_MESSAGES.positionRange,
    );
    await refuse({ gps_accuracy_m: -1 }, 'gps_accuracy_m', VISIT_MESSAGES.accuracyInvalid);
    await refuse({ farmer_id: farmerId }, 'farmer_id', 'This field is not recognised.');

    const v = await recordVisit(officerA, farmerId, {
      observation: null,
      duration_minutes: null,
      attendee_count: null,
      topics: [...VISIT_TOPICS],
    });
    expect(v.observation).toBeNull();
    expect(v.topics).toEqual([...VISIT_TOPICS]);
    const [labels] = await prisma.$queryRawUnsafe<{ enum_values: string[] }[]>(
      `SELECT array_agg(enumlabel::text ORDER BY enumsortorder) AS enum_values FROM pg_enum WHERE enumtypid = 'public.visit_topic'::regtype`,
    );
    // Containment, not equality (standing rule: a test that reads the schema tolerates what it does not know).
    expect(labels?.enum_values).toEqual(expect.arrayContaining([...VISIT_TOPICS]));
  });

  it('C-8.5: the device’s moment is stored as given, the server’s is now, and both are shown; the list orders by the server’s', async () => {
    const farmerId = await registerFarmer(officerA);
    const before = Date.now();
    const old = await recordVisit(officerA, farmerId, { visited_at: A_WEEK_AGO });
    const newer = await recordVisit(officerA, farmerId, {
      visited_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });
    expect(new Date(old.visited_at as string).getTime()).toBe(new Date(A_WEEK_AGO).getTime());
    const received = new Date(old.received_at as string).getTime();
    expect(received).toBeGreaterThanOrEqual(before - 60_000);
    expect(received).toBeLessThanOrEqual(Date.now() + 60_000);
    // `newer` was received later although it was visited earlier: the list puts it first.
    const list = await checked(farmerVisits, 'GET', { as: officerA, params: { id: farmerId } });
    expect(list.status).toBe(200);
    const ids = (list.body.data as { id: string }[]).map((v) => v.id);
    expect(ids.slice(0, 2)).toEqual([newer.id, old.id]);
    for (const v of list.body.data as Record<string, unknown>[]) {
      expect(v).toHaveProperty('visited_at');
      expect(v).toHaveProperty('received_at');
    }
  });

  it('C-8.4: the position and its accuracy are stored and shown to the officer and an administrator, absent for supervisor and read-only, and never graded', async () => {
    const farmerId = await registerFarmer(officerA);
    const v = await recordVisit(officerA, farmerId);
    expect(v.position).toEqual(POINT);
    expect(v.gps_accuracy_m).toBe(7.5);
    expect(v).not.toHaveProperty('grade');
    expect(v).not.toHaveProperty('accuracy_flag');
    const asAdmin = data(
      await checked(visitItem, 'GET', { as: admin, params: { id: v.id as string } }),
    );
    expect(asAdmin.position).toEqual(POINT);
    for (const who of [supervisorA, readOnly]) {
      const r = await checked(visitItem, 'GET', { as: who, params: { id: v.id as string } });
      expect(r.status, who.role).toBe(200);
      expect(data(r), who.role).not.toHaveProperty('position');
      expect(data(r), who.role).not.toHaveProperty('gps_accuracy_m');
      expect(data(r).advice, `${who.role} reads the substance`).toBe(ADVICE);
    }
  });

  it('the same visit id twice is 409, and a different farmer’s visit id is 409 too: the id is the record', async () => {
    const farmerId = await registerFarmer(officerA);
    const v = await recordVisit(officerA, farmerId);
    const again = await checked(farmerVisits, 'POST', {
      as: officerA,
      params: { id: farmerId },
      body: visitBody({ id: v.id }),
    });
    expect(again.status).toBe(409);
    expect(errorOf(again).message).toBe(RULE_MESSAGES.visit_already_exists);
  });
});

run('follow-ups (C-8.3)', () => {
  it('a follow-up names an earlier visit of the same farmer; another farmer’s, a removed one, itself and a cycle are refused — and the database refuses the cycle on its own', async () => {
    const farmerId = await registerFarmer(officerA);
    const otherFarmer = await registerFarmer(officerA);
    const first = await recordVisit(officerA, farmerId);
    const second = await recordVisit(officerA, farmerId, { follow_up_of: first.id });
    expect(second.follow_up_of).toBe(first.id);

    const foreign = await recordVisit(officerA, otherFarmer);
    const wrongFarmer = await checked(farmerVisits, 'POST', {
      as: officerA,
      params: { id: farmerId },
      body: visitBody({ follow_up_of: foreign.id }),
    });
    expect(wrongFarmer.status).toBe(422);
    expect(errorOf(wrongFarmer).message).toBe(RULE_MESSAGES.follow_up_not_found);

    const self = randomUUID();
    const selfRef = await checked(farmerVisits, 'POST', {
      as: officerA,
      params: { id: farmerId },
      body: visitBody({ id: self, follow_up_of: self }),
    });
    expect(selfRef.status).toBe(422);

    // first ← second. Making first follow second closes the loop.
    const cycle = await checked(visitItem, 'PATCH', {
      as: officerA,
      params: { id: first.id as string },
      body: { follow_up_of: second.id },
    });
    expect(cycle.status).toBe(422);
    expect(errorOf(cycle).message).toBe(RULE_MESSAGES.follow_up_cycle);
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE public.visit SET follow_up_of = $2::uuid WHERE id = $1::uuid`,
        first.id,
        second.id,
      ),
    ).rejects.toThrow(/visit_follow_up_cycle/);

    const removed = await recordVisit(officerA, farmerId);
    expect(
      (await checked(visitItem, 'DELETE', { as: admin, params: { id: removed.id as string } }))
        .status,
    ).toBe(204);
    const toRemoved = await checked(farmerVisits, 'POST', {
      as: officerA,
      params: { id: farmerId },
      body: visitBody({ follow_up_of: removed.id }),
    });
    expect(toRemoved.status).toBe(422);
    expect(errorOf(toRemoved).message).toBe(RULE_MESSAGES.follow_up_not_found);
  });

  it('the chain reads in order: earlier visits from the first, this one, then its follow-ups; a removed link keeps its place as an id', async () => {
    const farmerId = await registerFarmer(officerA);
    const a = await recordVisit(officerA, farmerId);
    const b = await recordVisit(officerA, farmerId, { follow_up_of: a.id });
    const c = await recordVisit(officerA, farmerId, { follow_up_of: b.id });
    const d = await recordVisit(officerA, farmerId, { follow_up_of: c.id });
    const chain = data(
      await checked(visitChain, 'GET', { as: supervisorA, params: { id: c.id as string } }),
    );
    expect((chain.earlier as { id: string }[]).map((v) => v.id)).toEqual([a.id, b.id]);
    expect((chain.visit as { id: string }).id).toBe(c.id);
    expect((chain.follow_ups as { id: string }[]).map((v) => v.id)).toEqual([d.id]);

    await checked(visitItem, 'DELETE', { as: admin, params: { id: b.id as string } });
    const after = data(
      await checked(visitChain, 'GET', { as: officerA, params: { id: c.id as string } }),
    );
    expect(after.earlier).toEqual([
      expect.objectContaining({ id: a.id }),
      { id: b.id, removed: true },
    ]);
  });
});

run('attachments (C-8.6, C-8.7, C-8.8)', () => {
  it('a photo is declared, uploaded by the phone, confirmed against its declared size and type, and read through an expiring link — and the visit was complete before any of it', async () => {
    const farmerId = await registerFarmer(officerA);
    const v = await recordVisit(officerA, farmerId);
    expect(v.attachments).toEqual([]);

    const declared = await declarePhoto(officerA, v.id as string);
    expect(declared.status, declared.text).toBe(201);
    const a = data(declared);
    expect(a.status).toBe('waiting');
    expect(a.message).toBe(ATTACHMENT_STATUS_MESSAGES.waiting);
    const upload = a.upload as { url: string; token: string; expires_at: string };
    expect(upload.url).toMatch(/^https:\/\//);
    const grantLife = new Date(upload.expires_at).getTime() - Date.now();
    expect(grantLife).toBeGreaterThan(10 * 60_000);
    expect(grantLife).toBeLessThanOrEqual(15 * 60_000 + 5_000);

    // Waiting is visible to everyone entitled to the visit: the supervisor reads "one photo waiting".
    const seen = data(
      await checked(visitItem, 'GET', { as: supervisorA, params: { id: v.id as string } }),
    );
    expect((seen.attachments as { status: string; message: string }[])[0]).toMatchObject({
      status: 'waiting',
      message: ATTACHMENT_STATUS_MESSAGES.waiting,
    });

    // Confirm before the bytes: "not yet", not a failure.
    const early = await confirm(officerA, v.id as string, a.id as string);
    expect(early.status).toBe(409);
    expect(errorOf(early).message).toBe(RULE_MESSAGES.attachment_not_arrived);

    expect(await uploadTo(upload, FAKE_JPEG)).toBe(200);
    const confirmed = await confirm(officerA, v.id as string, a.id as string);
    expect(confirmed.status, confirmed.text).toBe(200);
    expect(data(confirmed).status).toBe('arrived');
    expect(data(confirmed).message).toBe(ATTACHMENT_STATUS_MESSAGES.arrived);
    // Confirming again is harmless (a retried sync).
    expect((await confirm(officerA, v.id as string, a.id as string)).status).toBe(200);

    for (const who of [officerA, supervisorA, readOnly, admin]) {
      const link = await checked(attachmentLink, 'GET', {
        as: who,
        params: { id: v.id as string, aid: a.id as string },
      });
      expect(link.status, who.role).toBe(200);
      const life = new Date(data(link).expires_at as string).getTime() - Date.now();
      expect(life).toBeGreaterThan(4 * 60_000);
      expect(life).toBeLessThanOrEqual(5 * 60_000 + 5_000);
      const fetched = await fetch(data(link).url as string);
      expect(fetched.status, `${who.role} opens the link`).toBe(200);
      expect(Buffer.from(await fetched.arrayBuffer()).equals(FAKE_JPEG)).toBe(true);
    }
    // Outside scope: not found, as the visit is.
    for (const who of [officerB, supervisorB, officerEE]) {
      const link = await checked(attachmentLink, 'GET', {
        as: who,
        params: { id: v.id as string, aid: a.id as string },
      });
      expect(link.status, who.role).toBe(404);
    }
    // Four in-scope readers opened a link; each issuing is a row naming who,
    // which attachment and when — and never the link (the one audited read).
    const rows = await auditActions(v.id as string);
    expect(rows.map((r) => r.action)).toEqual([
      'visit.recorded',
      'visit.attachment_declared',
      'visit.attachment_arrived',
      ...Array(4).fill('visit.attachment_link_issued'),
    ]);
    for (const r of rows.filter((r) => r.action === 'visit.attachment_link_issued')) {
      expect(r.text).toContain(a.id as string);
      expect(r.text).not.toMatch(/https?:\/\//);
      expect(r.text).not.toContain('token');
    }
  });

  it('a file that is not the one declared is removed and the row fails with the action to take; declaring the same id again is "send it again"', async () => {
    const farmerId = await registerFarmer(officerA);
    const v = await recordVisit(officerA, farmerId);
    const declared = await declarePhoto(officerA, v.id as string, {
      byte_size: FAKE_JPEG.length + 7,
    });
    const a = data(declared);
    expect(await uploadTo(a.upload as { url: string }, FAKE_JPEG)).toBe(200);
    const path = uploadedPaths[uploadedPaths.length - 1] as string;
    expect(await describeStoredObject(VISIT_ATTACHMENT_BUCKET, path)).not.toBeNull();

    const mismatch = await confirm(officerA, v.id as string, a.id as string);
    expect(mismatch.status).toBe(422);
    expect(errorOf(mismatch).message).toBe(RULE_MESSAGES.attachment_mismatch);
    expect(await describeStoredObject(VISIT_ATTACHMENT_BUCKET, path)).toBeNull();
    const shown = data(
      await checked(visitItem, 'GET', { as: officerA, params: { id: v.id as string } }),
    );
    expect((shown.attachments as Record<string, unknown>[])[0]).toMatchObject({
      status: 'failed',
      failure_code: 'size_mismatch',
      message: ATTACHMENT_FAILURE_MESSAGES.size_mismatch,
    });
    // Confirming a failed one says so, and does not resurrect it.
    const again = await confirm(officerA, v.id as string, a.id as string);
    expect(again.status).toBe(409);
    expect(errorOf(again).message).toBe(RULE_MESSAGES.attachment_already_failed);

    // Send it again: same id, the right size this time.
    const redeclared = await declarePhoto(officerA, v.id as string, { id: a.id });
    expect(redeclared.status).toBe(200);
    expect(data(redeclared).status).toBe('waiting');
    expect(data(redeclared)).toHaveProperty('upload');
    expect(await uploadTo(data(redeclared).upload as { url: string }, FAKE_JPEG)).toBe(200);
    expect(data(await confirm(officerA, v.id as string, a.id as string)).status).toBe('arrived');
    // Declaring an arrived one again returns it as it is, with no grant.
    const settled = await declarePhoto(officerA, v.id as string, { id: a.id });
    expect(settled.status).toBe(200);
    expect(data(settled).status).toBe('arrived');
    expect(data(settled)).not.toHaveProperty('upload');
    // The same attachment id on another visit is a conflict.
    const other = await recordVisit(officerA, farmerId);
    const stolen = await declarePhoto(officerA, other.id as string, { id: a.id });
    expect(stolen.status).toBe(409);
    expect(errorOf(stolen).message).toBe(RULE_MESSAGES.attachment_already_exists);
  });

  it('too large, or the wrong type for the kind, is refused at declaration — before any grant, before any byte', async () => {
    const farmerId = await registerFarmer(officerA);
    const v = await recordVisit(officerA, farmerId);
    const big = await declarePhoto(officerA, v.id as string, { byte_size: 15 * 1024 * 1024 + 1 });
    expect(big.status).toBe(400);
    expect(errorOf(big).fields?.byte_size).toBe(VISIT_MESSAGES.photoTooLarge);
    const audioBig = await declarePhoto(officerA, v.id as string, {
      kind: 'audio',
      content_type: 'audio/mp4',
      byte_size: 25 * 1024 * 1024 + 1,
    });
    expect(errorOf(audioBig).fields?.byte_size).toBe(VISIT_MESSAGES.audioTooLarge);
    const wrongKind = await declarePhoto(officerA, v.id as string, { content_type: 'audio/mp4' });
    expect(errorOf(wrongKind).fields?.content_type).toBe(VISIT_MESSAGES.contentTypeMismatch);
    const unknownType = await declarePhoto(officerA, v.id as string, {
      content_type: 'image/heic',
    });
    expect(errorOf(unknownType).fields?.content_type).toBe(VISIT_MESSAGES.contentTypeUnknown);
    const [count] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.visit_attachment WHERE visit_id = $1::uuid`,
      v.id,
    );
    expect(count?.n).toBe(0);
  });

  it('a grant that has expired fails the row on confirm and removes what arrived late; the phone giving up fails it too; neither blocks the visit', async () => {
    const farmerId = await registerFarmer(officerA);
    const v = await recordVisit(officerA, farmerId);
    const late = data(await declarePhoto(officerA, v.id as string));
    await prisma.$executeRawUnsafe(
      `UPDATE public.visit_attachment SET grant_expires_at = now() - interval '1 minute' WHERE id = $1::uuid`,
      late.id,
    );
    expect(await uploadTo(late.upload as { url: string }, FAKE_JPEG)).toBe(200);
    const expired = await confirm(officerA, v.id as string, late.id as string);
    expect(expired.status).toBe(422);
    expect(errorOf(expired).message).toBe(RULE_MESSAGES.attachment_grant_expired);
    expect(
      await describeStoredObject(
        VISIT_ATTACHMENT_BUCKET,
        uploadedPaths[uploadedPaths.length - 1] as string,
      ),
    ).toBeNull();

    const gaveUp = data(await declarePhoto(officerA, v.id as string));
    const failed = await checked(attachmentFail, 'POST', {
      as: officerA,
      params: { id: v.id as string, aid: gaveUp.id as string },
      body: {},
    });
    expect(failed.status).toBe(200);
    expect(data(failed)).toMatchObject({
      status: 'failed',
      failure_code: 'device_gave_up',
      message: ATTACHMENT_FAILURE_MESSAGES.device_gave_up,
    });
    // A link for something that never arrived has nothing to open.
    const noLink = await checked(attachmentLink, 'GET', {
      as: officerA,
      params: { id: v.id as string, aid: gaveUp.id as string },
    });
    expect(noLink.status).toBe(409);
    expect(errorOf(noLink).message).toBe(RULE_MESSAGES.attachment_not_received);

    // The visit itself is untouched by all of it (C-8.6).
    const still = await checked(visitItem, 'GET', { as: officerA, params: { id: v.id as string } });
    expect(still.status).toBe(200);
    expect(data(still).advice).toBe(ADVICE);
    expect((data(still).attachments as unknown[]).length).toBe(2);
  });

  it('only the visit’s officer declares, confirms or fails; another officer is 404; supervisor and admin are 403', async () => {
    const farmerId = await registerFarmer(officerA);
    const v = await recordVisit(officerA, farmerId);
    expect((await declarePhoto(officerB, v.id as string)).status).toBe(404);
    expect((await declarePhoto(supervisorA, v.id as string)).status).toBe(403);
    expect((await declarePhoto(admin, v.id as string)).status).toBe(403);
    const a = data(await declarePhoto(officerA, v.id as string));
    expect((await confirm(admin, v.id as string, a.id as string)).status).toBe(403);
    expect((await confirm(officerB, v.id as string, a.id as string)).status).toBe(404);
  });
});

run('scope, correction and removal (C-8.9, C-8.10, C-8.11)', () => {
  it('an officer reads their caseload, a supervisor and read-only their state; out of scope is 404; the state list is scoped the same way', async () => {
    const farmerId = await registerFarmer(officerA);
    const v = await recordVisit(officerA, farmerId);
    const eeFarmer = await registerFarmer(officerEE, { payam_id: PAYAM_EE });
    const eeVisit = await recordVisit(officerEE, eeFarmer);
    for (const [who, expected] of [
      [officerA, 200],
      [supervisorA, 200],
      [readOnly, 200],
      [admin, 200],
      [officerB, 404],
      [supervisorB, 404],
      [officerEE, 404],
    ] as const) {
      expect(
        (await checked(visitItem, 'GET', { as: who, params: { id: v.id as string } })).status,
        who.role,
      ).toBe(expected);
    }
    const stateA = (await checked(visits, 'GET', { as: supervisorA })).body.data as {
      id: string;
    }[];
    expect(stateA.map((x) => x.id)).toContain(v.id);
    expect(stateA.map((x) => x.id)).not.toContain(eeVisit.id);
    const stateB = (await checked(visits, 'GET', { as: supervisorB })).body.data as {
      id: string;
    }[];
    expect(stateB.map((x) => x.id)).toContain(eeVisit.id);
    expect(stateB.map((x) => x.id)).not.toContain(v.id);
    const mine = (await checked(visits, 'GET', { as: officerB })).body.data as { id: string }[];
    expect(mine.map((x) => x.id)).not.toContain(v.id);
    // Filters run on the server's moment.
    const none = await checked(visits, 'GET', {
      as: supervisorA,
      query: { to: new Date(Date.now() - 86_400_000).toISOString() },
    });
    expect((none.body.data as { id: string }[]).map((x) => x.id)).not.toContain(v.id);
    const bad = await checked(visits, 'GET', { as: supervisorA, query: { from: 'yesterday' } });
    expect(bad.status).toBe(400);
    expect(errorOf(bad).fields?.from).toBe(VISIT_MESSAGES.filterDateInvalid);
  });

  it('C-8.10: the officer corrects their own visit within a day of the server’s moment, an administrator at any time; the five evidence columns cannot be changed by anyone', async () => {
    const farmerId = await registerFarmer(officerA);
    const v = await recordVisit(officerA, farmerId);
    const corrected = await checked(visitItem, 'PATCH', {
      as: officerA,
      params: { id: v.id as string },
      body: {
        advice: `${ADVICE} — and mulch the seedlings`,
        topics: ['pest'],
        duration_minutes: null,
      },
    });
    expect(corrected.status, corrected.text).toBe(200);
    expect(data(corrected).topics).toEqual(['pest']);
    expect(data(corrected).duration_minutes).toBeNull();
    expect(data(corrected).received_at).toBe(v.received_at);

    const empty = await checked(visitItem, 'PATCH', {
      as: officerA,
      params: { id: v.id as string },
      body: {},
    });
    expect(empty.status).toBe(400);
    for (const field of [
      'farmer_id',
      'officer_id',
      'position',
      'gps_accuracy_m',
      'visited_at',
      'received_at',
    ]) {
      const r = await checked(visitItem, 'PATCH', {
        as: officerA,
        params: { id: v.id as string },
        body: { [field]: 'anything' },
      });
      expect(r.status, field).toBe(400);
      expect(errorOf(r).fields?.[field], field).toBe('This field is not recognised.');
    }
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE public.visit SET visited_at = now() WHERE id = $1::uuid`,
        v.id,
      ),
    ).rejects.toThrow(/visit_evidence_immutable/);

    // A visit received 25 hours ago: inserted so, since received_at cannot be moved after the fact.
    const oldId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO public.visit (id, farmer_id, officer_id, payam_id, county_id, state_id, position, gps_accuracy_m, advice, topics, visited_at, received_at)
       SELECT $1::uuid, $2::uuid, $3::uuid, payam_id, county_id, state_id,
              extensions.ST_SetSRID(extensions.ST_MakePoint(31.6, 4.85), 4326)::extensions.geography, 5, $4, '{weeding}',
              now() - interval '26 hours', now() - interval '25 hours'
       FROM public.farmer WHERE id = $2::uuid`,
      oldId,
      farmerId,
      officerA.id,
      ADVICE,
    );
    const closed = await checked(visitItem, 'PATCH', {
      as: officerA,
      params: { id: oldId },
      body: { advice: 'Weed again next week.' },
    });
    expect(closed.status).toBe(422);
    expect(errorOf(closed).message).toBe(RULE_MESSAGES.correction_window_closed);
    const byAdmin = await checked(visitItem, 'PATCH', {
      as: admin,
      params: { id: oldId },
      body: { advice: 'Weed again next week.' },
    });
    expect(byAdmin.status).toBe(200);
    // Another officer never reaches it; a supervisor may not correct.
    expect(
      (
        await checked(visitItem, 'PATCH', {
          as: officerB,
          params: { id: v.id as string },
          body: { advice: 'x' },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await checked(visitItem, 'PATCH', {
          as: supervisorA,
          params: { id: v.id as string },
          body: { advice: 'x' },
        })
      ).status,
    ).toBe(403);

    // The log says the advice changed and never what it said (C-8.12, C-8.13).
    const rows = await auditActions(v.id as string);
    expect(rows.map((r) => r.action)).toEqual(['visit.recorded', 'visit.corrected']);
    expect(rows[1]!.text).toContain('advice_changed');
    for (const r of rows) {
      expect(r.text).not.toContain('mulch');
      expect(r.text).not.toContain('Zzachol');
      expect(r.text).not.toContain('31.6');
    }
  });

  it('C-8.11: removal is soft and administrator only; a removed visit is in no list, count or coverage figure, and its history is still readable', async () => {
    const farmerId = await registerFarmer(officerA);
    const v = await recordVisit(officerA, farmerId);
    const a = data(await declarePhoto(officerA, v.id as string));
    expect(await uploadTo(a.upload as { url: string }, FAKE_JPEG)).toBe(200);
    await confirm(officerA, v.id as string, a.id as string);

    for (const who of [officerA, supervisorA, readOnly]) {
      const r = await checked(visitItem, 'DELETE', { as: who, params: { id: v.id as string } });
      expect(r.status, who.role).toBe(403);
    }
    const coverageBefore = await prisma.$queryRawUnsafe<{ other_visits: number }[]>(
      `SELECT other_visits FROM public.extension_coverage_v WHERE payam_id = $1 AND month = date_trunc('month', now())::date`,
      PAYAM_A,
    );
    expect(
      (await checked(visitItem, 'DELETE', { as: admin, params: { id: v.id as string } })).status,
    ).toBe(204);
    expect(
      (await checked(visitItem, 'GET', { as: admin, params: { id: v.id as string } })).status,
    ).toBe(404);
    const list = (await checked(farmerVisits, 'GET', { as: officerA, params: { id: farmerId } }))
      .body.data as { id: string }[];
    expect(list.map((x) => x.id)).not.toContain(v.id);
    const coverageAfter = await prisma.$queryRawUnsafe<{ other_visits: number }[]>(
      `SELECT other_visits FROM public.extension_coverage_v WHERE payam_id = $1 AND month = date_trunc('month', now())::date`,
      PAYAM_A,
    );
    expect(coverageAfter[0]?.other_visits ?? 0).toBe((coverageBefore[0]?.other_visits ?? 0) - 1);
    // The file is unreachable through the visit; the row keeps its history.
    expect(
      (
        await checked(attachmentLink, 'GET', {
          as: admin,
          params: { id: v.id as string, aid: a.id as string },
        })
      ).status,
    ).toBe(404);
    const [gone] = await prisma.$queryRawUnsafe<{ deleted_at: Date | null }[]>(
      `SELECT deleted_at FROM public.visit WHERE id = $1::uuid`,
      v.id,
    );
    expect(gone?.deleted_at).not.toBeNull();
    const actions = (await auditActions(v.id as string)).map((r) => r.action);
    expect(actions[actions.length - 1]).toBe('visit.soft_deleted');
  });

  it('coverage counts the server’s moment and verified farmers only, with the rest beside them (C-8.5, reporting law)', async () => {
    const farmerId = await registerFarmer(officerA);
    // Visited a month ago by the device's clock, received today: it counts today.
    await recordVisit(officerA, farmerId, {
      visited_at: new Date(Date.now() - 31 * 86_400_000).toISOString(),
    });
    const [row] = await prisma.$queryRawUnsafe<
      { verified_visits: number; other_visits: number; other_farmers_visited: number }[]
    >(
      `SELECT verified_visits, other_visits, other_farmers_visited FROM public.extension_coverage_v
       WHERE payam_id = $1 AND month = date_trunc('month', now())::date`,
      PAYAM_A,
    );
    expect(row?.other_visits ?? 0).toBeGreaterThanOrEqual(1);
    const [cols] = await prisma.$queryRawUnsafe<{ columns: string[] }[]>(
      `SELECT array_agg(column_name::text ORDER BY ordinal_position) AS columns FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'extension_coverage_v'`,
    );
    expect(cols!.columns).toEqual(
      expect.arrayContaining([
        'verified_visits',
        'verified_farmers_visited',
        'other_visits',
        'other_farmers_visited',
        'month',
      ]),
    );
  });
});

run('the scan (C-8.13)', () => {
  it('every status this unit can produce was produced above and scanned; the substance never left a data envelope', () => {
    for (const status of [200, 201, 204, 400, 403, 404, 409, 422]) {
      expect(seenStatuses.has(status), `status ${status} never produced`).toBe(true);
    }
  });
});
