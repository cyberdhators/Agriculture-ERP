import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as farmerFarms from '../apps/web/app/api/farmers/[id]/farms/route';
import * as farmerVisits from '../apps/web/app/api/farmers/[id]/visits/route';
import * as attachmentConfirm from '../apps/web/app/api/visits/[id]/attachments/[aid]/confirm/route';
import * as attachmentFail from '../apps/web/app/api/visits/[id]/attachments/[aid]/fail/route';
import * as attachmentLink from '../apps/web/app/api/visits/[id]/attachments/[aid]/link/route';
import * as visitAttachments from '../apps/web/app/api/visits/[id]/attachments/route';
import * as visitChain from '../apps/web/app/api/visits/[id]/chain/route';
import * as visitItem from '../apps/web/app/api/visits/[id]/route';
import * as visitsList from '../apps/web/app/api/visits/route';
import * as farmerItem from '../apps/web/app/api/farmers/[id]/route';
import * as farmBoundaries from '../apps/web/app/api/farms/[id]/boundaries/route';
import * as farmCrops from '../apps/web/app/api/farms/[id]/crops/route';
import * as farmItem from '../apps/web/app/api/farms/[id]/route';
import * as farmsGeojson from '../apps/web/app/api/farms/geojson/route';
import * as farmsList from '../apps/web/app/api/farms/route';
import * as syncCaseload from '../apps/web/app/api/sync/caseload/route';
import * as farmerMerge from '../apps/web/app/api/farmers/[id]/merge/route';
import * as farmerReassign from '../apps/web/app/api/farmers/[id]/reassign/route';
import * as farmerReject from '../apps/web/app/api/farmers/[id]/reject/route';
import * as farmerResubmit from '../apps/web/app/api/farmers/[id]/resubmit/route';
import * as farmerVerify from '../apps/web/app/api/farmers/[id]/verify/route';
import * as farmers from '../apps/web/app/api/farmers/route';
import * as verificationQueue from '../apps/web/app/api/verification/queue/route';
import * as locations from '../apps/web/app/api/locations/route';
import * as me from '../apps/web/app/api/me/route';
import * as officerItem from '../apps/web/app/api/officers/[id]/route';
import * as officers from '../apps/web/app/api/officers/route';
import * as userItem from '../apps/web/app/api/users/[id]/route';
import * as users from '../apps/web/app/api/users/route';
import { randomUUID } from 'node:crypto';
import {
  FARMER_TEST_FAMILY,
  type TestPrincipal,
  createPrincipal,
  sweep,
} from './helpers/principals';
import { removeStoredObject } from '../apps/web/lib/supabase/admin';
import { VISIT_ATTACHMENT_BUCKET } from '../packages/shared/src/visit';
import { makeTestPrisma, requireTestEnv } from './helpers/db';
import { call } from './helpers/request';

/**
 * ============================================================================
 * THE FORBIDDEN MATRIX. Every route x every role x no session.
 * ============================================================================
 *
 * This is the deliverable of B3, not the routes.
 *
 * A missed scope check is invisible: the query runs, the JSON is well formed,
 * the status is 200, and every behaviour test agrees the route works. The
 * officer in Yei simply gets the farmer in Juba. Only a test written to assert
 * a REFUSAL catches it, which is why refusals are the product here.
 *
 * Each case is asserted in both directions -- the roles that may, and the roles
 * that may not -- per the standing rule in docs/PROJECT-STATE.md. A guard that
 * refuses everything passes every refusal test perfectly.
 */

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

requireTestEnv();
const run = describe;

const prisma = makeTestPrisma();

let admin: TestPrincipal & { password: string };
let supervisor: TestPrincipal & { password: string };
let readOnly: TestPrincipal & { password: string };
let officer: TestPrincipal & { password: string };

const STATE_A = 'CE';
const PAYAM_A = 'CE-JUB-MUN';

beforeAll(async () => {
  await sweep(prisma);
  admin = await createPrincipal(prisma, 'admin');
  supervisor = await createPrincipal(prisma, 'supervisor', { stateId: STATE_A });
  readOnly = await createPrincipal(prisma, 'read_only', { stateId: STATE_A });
  officer = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
  // B5: one farmer the officer registered, for the item routes.
  const registered = await call(farmers, 'POST', { as: officer, body: farmerBody() });
  if (registered.status !== 201) {
    throw new Error(`matrix setup: could not register a farmer (${registered.status})`);
  }
  farmerId = (registered.body.data as { id: string }).id;
  // B7: one farm the officer mapped, for the farm routes.
  const mapped = await call(farmerFarms, 'POST', {
    as: officer,
    body: farmBody(),
    params: { id: farmerId },
  });
  if (mapped.status !== 201)
    throw new Error(`matrix setup: could not map a farm (${mapped.status})`);
  farmId = (mapped.body.data as { id: string }).id;
  // B8: one visit the officer recorded, with one photo that has arrived, so
  // the link route has something to open for every role allowed to read it.
  const visited = await call(farmerVisits, 'POST', {
    as: officer,
    body: visitBody(),
    params: { id: farmerId },
  });
  if (visited.status !== 201)
    throw new Error(`matrix setup: could not record a visit (${visited.status})`);
  visitId = (visited.body.data as { id: string }).id;
  const declared = await call(visitAttachments, 'POST', {
    as: officer,
    body: {
      id: randomUUID(),
      kind: 'photo',
      content_type: 'image/jpeg',
      byte_size: FAKE_JPEG.length,
      captured_at: new Date().toISOString(),
    },
    params: { id: visitId },
  });
  if (declared.status !== 201)
    throw new Error(`matrix setup: could not declare an attachment (${declared.status})`);
  const attachment = declared.body.data as { id: string; upload: { url: string } };
  attachmentId = attachment.id;
  const put = await fetch(attachment.upload.url, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
    body: new Uint8Array(FAKE_JPEG),
  });
  if (put.status !== 200) throw new Error(`matrix setup: upload refused (${put.status})`);
  uploadedPath = decodeURIComponent(
    new URL(attachment.upload.url).pathname.split('/object/upload/sign/')[1] ?? '',
  ).replace(`${VISIT_ATTACHMENT_BUCKET}/`, '');
  const confirmed = await call(attachmentConfirm, 'POST', {
    as: officer,
    body: {},
    params: { id: visitId, aid: attachmentId },
  });
  if (confirmed.status !== 200)
    throw new Error(`matrix setup: could not confirm the attachment (${confirmed.status})`);
});
let visitId = '';
let attachmentId = '';
let uploadedPath = '';
const FAKE_JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
  Buffer.from('zztest-not-a-real-photo-'.repeat(20)),
  Buffer.from([0xff, 0xd9]),
]);
const visitBody = () => ({
  id: randomUUID(),
  visited_at: new Date(Date.now() - 3_600_000).toISOString(),
  position: { type: 'Point', coordinates: [31.6004, 4.8503] },
  gps_accuracy_m: 6,
  advice: 'Zztest advice: weed the lower plot before the rains.',
  topics: ['weeding'],
});
let farmId = '';
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
const farmBody = () => ({
  id: randomUUID(),
  boundary_id: randomUUID(),
  season: '2026-main',
  boundary: SQUARE,
  gps_accuracy_m: 6,
});
let farmerId = '';
let phoneSeq = 0;
const farmerBody = () => ({
  id: randomUUID(),
  given_name: 'Zzmatrix',
  family_name: FARMER_TEST_FAMILY,
  sex: 'f',
  year_of_birth: 1985,
  phone: `+21191${String(7_000_000 + Math.floor(Math.random() * 999_999) + (phoneSeq += 1)).padStart(7, '0')}`,
  payam_id: PAYAM_A,
  consent: { text_version: 'v1.0-en', language: 'en', granted: true },
});

afterAll(async () => {
  if (uploadedPath) await removeStoredObject(VISIT_ATTACHMENT_BUCKET, uploadedPath).catch(() => {});
  await sweep(prisma);
  await prisma.$disconnect();
});

const principals = () => ({ admin, supervisor, read_only: readOnly, officer });

/** Every route, the roles allowed, and how to call it. */
const ROUTES = [
  {
    name: 'GET /api/me',
    mod: me,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only', 'officer'],
  },
  {
    name: 'GET /api/locations',
    mod: locations,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only', 'officer'],
  },
  {
    name: 'GET /api/users',
    mod: users,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only'],
  },
  {
    name: 'POST /api/users',
    mod: users,
    method: 'POST' as const,
    allow: ['admin'],
    body: () => ({
      name: 'zztest-created',
      email: `zztest-${Math.random().toString(36).slice(2, 8)}@example.invalid`,
      password: 'a-long-enough-password',
      role: 'admin',
    }),
  },
  {
    name: 'GET /api/users/:id',
    mod: userItem,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only'],
    // NOT admin.id: an admin has no state, so a supervisor cannot see one.
    // That is correct behaviour, asserted directly in the scope tests.
    params: () => ({ id: readOnly.id }),
  },
  {
    name: 'PATCH /api/users/:id',
    mod: userItem,
    method: 'PATCH' as const,
    allow: ['admin'],
    params: () => ({ id: readOnly.id }),
    body: () => ({ name: 'zztest-renamed' }),
  },
  {
    name: 'DELETE /api/users/:id',
    mod: userItem,
    method: 'DELETE' as const,
    allow: ['admin'],
    params: () => ({ id: readOnly.id }),
  },
  {
    name: 'GET /api/officers',
    mod: officers,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only', 'officer'],
  },
  {
    name: 'POST /api/officers',
    mod: officers,
    method: 'POST' as const,
    allow: ['admin'],
    body: () => ({
      name: 'zztest-created-officer',
      phone: `+2119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      password: 'a-long-enough-password',
      payam_id: PAYAM_A,
    }),
  },
  {
    name: 'GET /api/officers/:id',
    mod: officerItem,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only', 'officer'],
    params: () => ({ id: officer.id }),
  },
  {
    name: 'PATCH /api/officers/:id',
    mod: officerItem,
    method: 'PATCH' as const,
    allow: ['admin'],
    params: () => ({ id: officer.id }),
    body: () => ({ name: 'zztest-renamed-officer' }),
  },
  {
    name: 'DELETE /api/officers/:id',
    mod: officerItem,
    method: 'DELETE' as const,
    allow: ['admin'],
    params: () => ({ id: officer.id }),
  },
  // B5 (C-5). The officer registered the farmer, so the item routes are in their caseload.
  {
    name: 'GET /api/farmers',
    mod: farmers,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only', 'officer'],
  },
  {
    name: 'POST /api/farmers',
    mod: farmers,
    method: 'POST' as const,
    allow: ['admin', 'officer'],
    body: () => farmerBody(),
  },
  {
    name: 'GET /api/farmers/:id',
    mod: farmerItem,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only', 'officer'],
    params: () => ({ id: farmerId }),
  },
  {
    name: 'PATCH /api/farmers/:id',
    mod: farmerItem,
    method: 'PATCH' as const,
    allow: ['admin', 'officer'],
    params: () => ({ id: farmerId }),
    body: () => ({ given_name: 'Zzrenamed' }),
  },
  {
    name: 'DELETE /api/farmers/:id',
    mod: farmerItem,
    method: 'DELETE' as const,
    allow: ['admin'],
    params: () => ({ id: farmerId }),
  },
  // B6 (C-6). The matrix farmer is pending and in state CE, the supervisor's state.
  {
    name: 'POST /api/farmers/:id/verify',
    mod: farmerVerify,
    method: 'POST' as const,
    allow: ['admin', 'supervisor'],
    params: () => ({ id: farmerId }),
  },
  {
    name: 'POST /api/farmers/:id/reject',
    mod: farmerReject,
    method: 'POST' as const,
    allow: ['admin', 'supervisor'],
    params: () => ({ id: farmerId }),
    body: () => ({ reason_code: 'other' }),
  },
  {
    name: 'POST /api/farmers/:id/merge',
    mod: farmerMerge,
    method: 'POST' as const,
    allow: ['admin', 'supervisor'],
    params: () => ({ id: farmerId }),
    body: () => ({ target_id: farmerId }),
  },
  {
    name: 'POST /api/farmers/:id/resubmit',
    mod: farmerResubmit,
    method: 'POST' as const,
    allow: ['officer'],
    params: () => ({ id: farmerId }),
  },
  {
    name: 'GET /api/verification/queue',
    mod: verificationQueue,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only'],
  },
  // B7 (C-7). The officer mapped the farm; the admin may only read and remove.
  {
    name: 'POST /api/farmers/:id/farms',
    mod: farmerFarms,
    method: 'POST' as const,
    allow: ['officer'],
    params: () => ({ id: farmerId }),
    body: () => farmBody(),
  },
  {
    name: 'GET /api/farmers/:id/farms',
    mod: farmerFarms,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only', 'officer'],
    params: () => ({ id: farmerId }),
  },
  {
    name: 'GET /api/farms/:id',
    mod: farmItem,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only', 'officer'],
    params: () => ({ id: farmId }),
  },
  {
    name: 'POST /api/farms/:id/boundaries',
    mod: farmBoundaries,
    method: 'POST' as const,
    allow: ['officer'],
    params: () => ({ id: farmId }),
    body: () => ({ id: randomUUID(), season: '2026-second', boundary: SQUARE, gps_accuracy_m: 6 }),
  },
  {
    name: 'GET /api/farms/:id/boundaries',
    mod: farmBoundaries,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only', 'officer'],
    params: () => ({ id: farmId }),
  },
  {
    name: 'PUT /api/farms/:id/crops',
    mod: farmCrops,
    method: 'PUT' as const,
    allow: ['officer'],
    params: () => ({ id: farmId }),
    body: () => ({ season: '2026-main', crops: ['maize'] }),
  },
  {
    name: 'GET /api/farms/geojson',
    mod: farmsGeojson,
    method: 'GET' as const,
    allow: ['admin', 'supervisor'],
  },
  {
    name: 'DELETE /api/farms/:id',
    mod: farmItem,
    method: 'DELETE' as const,
    allow: ['admin'],
    params: () => ({ id: farmId }),
  },
  // B9 (C-9). The farms list for everyone in scope; the caseload for officers only.
  {
    name: 'GET /api/farms',
    mod: farmsList,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only', 'officer'],
  },
  {
    name: 'GET /api/sync/caseload',
    mod: syncCaseload,
    method: 'GET' as const,
    allow: ['officer'],
  },
  // B8.5 (C-8R). Only an administrator moves a caseload.
  {
    name: 'POST /api/farmers/:id/reassign',
    mod: farmerReassign,
    method: 'POST' as const,
    allow: ['admin'],
    params: () => ({ id: farmerId }),
    body: () => ({ officer_id: randomUUID() }),
  },
  // B8 (C-8). The officer visited; the admin corrects and removes; everyone in scope reads.
  {
    name: 'POST /api/farmers/:id/visits',
    mod: farmerVisits,
    method: 'POST' as const,
    allow: ['officer'],
    params: () => ({ id: farmerId }),
    body: () => visitBody(),
  },
  {
    name: 'GET /api/farmers/:id/visits',
    mod: farmerVisits,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only', 'officer'],
    params: () => ({ id: farmerId }),
  },
  {
    name: 'GET /api/visits',
    mod: visitsList,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only', 'officer'],
  },
  {
    name: 'GET /api/visits/:id',
    mod: visitItem,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only', 'officer'],
    params: () => ({ id: visitId }),
  },
  {
    name: 'PATCH /api/visits/:id',
    mod: visitItem,
    method: 'PATCH' as const,
    allow: ['admin', 'officer'],
    params: () => ({ id: visitId }),
    body: () => ({ topics: ['weeding', 'planting'] }),
  },
  {
    name: 'DELETE /api/visits/:id',
    mod: visitItem,
    method: 'DELETE' as const,
    allow: ['admin'],
    params: () => ({ id: visitId }),
  },
  {
    name: 'GET /api/visits/:id/chain',
    mod: visitChain,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only', 'officer'],
    params: () => ({ id: visitId }),
  },
  {
    name: 'POST /api/visits/:id/attachments',
    mod: visitAttachments,
    method: 'POST' as const,
    allow: ['officer'],
    params: () => ({ id: visitId }),
    body: () => ({
      id: randomUUID(),
      kind: 'photo',
      content_type: 'image/jpeg',
      byte_size: 1234,
      captured_at: new Date().toISOString(),
    }),
  },
  {
    name: 'GET /api/visits/:id/attachments',
    mod: visitAttachments,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only', 'officer'],
    params: () => ({ id: visitId }),
  },
  {
    name: 'POST /api/visits/:id/attachments/:aid/confirm',
    mod: attachmentConfirm,
    method: 'POST' as const,
    allow: ['officer'],
    params: () => ({ id: visitId, aid: attachmentId }),
    body: () => ({}),
  },
  {
    name: 'POST /api/visits/:id/attachments/:aid/fail',
    mod: attachmentFail,
    method: 'POST' as const,
    allow: ['officer'],
    params: () => ({ id: visitId, aid: attachmentId }),
    body: () => ({}),
  },
  {
    name: 'GET /api/visits/:id/attachments/:aid/link',
    mod: attachmentLink,
    method: 'GET' as const,
    allow: ['admin', 'supervisor', 'read_only', 'officer'],
    params: () => ({ id: visitId, aid: attachmentId }),
  },
];

run('no session reaches any route', () => {
  it.each(ROUTES.map((r) => [r.name, r]))('%s returns 401 with no session', async (_n, route) => {
    const r = route as (typeof ROUTES)[number];
    const result = await call(r.mod, r.method, {
      as: null,
      params: r.params?.(),
      body: r.body?.(),
    });
    expect(result.status, `${r.name} let an unauthenticated caller through`).toBe(401);
    expect(result.body).toMatchObject({ error: { code: 'unauthenticated' } });
  });

  it.each(ROUTES.map((r) => [r.name, r]))('%s returns 401 with a junk token', async (_n, route) => {
    const r = route as (typeof ROUTES)[number];
    const result = await call(r.mod, r.method, {
      as: { accessToken: 'not-a-real-token' } as TestPrincipal,
      params: r.params?.(),
      body: r.body?.(),
    });
    expect(result.status).toBe(401);
  });
});

run('roles that may not, do not', () => {
  const cases = ROUTES.flatMap((r) =>
    (['admin', 'supervisor', 'read_only', 'officer'] as const)
      .filter((role) => !r.allow.includes(role))
      .map((role) => [`${r.name} rejects ${role}`, r, role] as const),
  );

  it.each(cases.map((c) => [c[0], c[1], c[2]]))('%s', async (_n, route, role) => {
    const r = route as (typeof ROUTES)[number];
    const who = principals()[role as keyof ReturnType<typeof principals>];
    const result = await call(r.mod, r.method, { as: who, params: r.params?.(), body: r.body?.() });
    expect(result.status, `${r.name} let ${role} through`).toBe(403);
    expect(result.body).toMatchObject({ error: { code: 'forbidden' } });
  });
});

run('roles that may, do', () => {
  // The other direction. Without this the suite would pass if every route
  // refused everyone -- the B1.3 lesson, and the reason this file is not
  // refusals alone.
  const readable = ROUTES.filter((r) => r.method === 'GET');
  const cases = readable.flatMap((r) =>
    r.allow.map((role) => [`${r.name} allows ${role}`, r, role] as const),
  );

  it.each(cases.map((c) => [c[0], c[1], c[2]]))('%s', async (_n, route, role) => {
    const r = route as (typeof ROUTES)[number];
    const who = principals()[role as keyof ReturnType<typeof principals>];
    const result = await call(r.mod, r.method, { as: who, params: r.params?.() });
    expect([200, 304], `${r.name} refused ${role}, who is allowed`).toContain(result.status);
  });
});

run('read_only cannot write anything, anywhere (C-3.9)', () => {
  const writes = ROUTES.filter((r) => r.method !== 'GET');

  it.each(writes.map((r) => [r.name, r]))('%s rejects read_only', async (_n, route) => {
    const r = route as (typeof ROUTES)[number];
    const result = await call(r.mod, r.method, {
      as: readOnly,
      params: r.params?.(),
      body: r.body?.(),
    });
    expect(result.status, `${r.name} let read_only write`).toBe(403);
  });
});

run('every response carries a correlation id', () => {
  it.each(ROUTES.map((r) => [r.name, r]))('%s, even when refusing', async (_n, route) => {
    const r = route as (typeof ROUTES)[number];
    const result = await call(r.mod, r.method, {
      as: null,
      params: r.params?.(),
      body: r.body?.(),
    });
    expect(result.headers.get('x-correlation-id'), `${r.name} sent no correlation id`).toBeTruthy();
  });

  it('echoes one the caller supplied, so a client can follow its own request', async () => {
    const result = await call(me, 'GET', {
      as: admin,
      headers: { 'x-correlation-id': 'zztest-given-id' },
    });
    expect(result.headers.get('x-correlation-id')).toBe('zztest-given-id');
  });
});
