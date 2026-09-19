import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as communications from '../apps/web/app/api/admin/communications/route';
import * as adminQueue from '../apps/web/app/api/admin/product-reports/route';
import * as adminDetail from '../apps/web/app/api/admin/product-reports/[id]/route';
import * as unreadCount from '../apps/web/app/api/admin/product-reports/unread-count/route';
import * as submit from '../apps/web/app/api/listings/[id]/reports/route';
import { type TestPrincipal, createPrincipal, sweep } from './helpers/principals';
import { makeTestPrisma, requireTestEnv } from './helpers/db';
import { call } from './helpers/request';

/**
 * ============================================================================
 * THE FORBIDDEN MATRIX FOR PROMPT 13'S ROUTES.
 * ============================================================================
 *
 * The same discipline as tests/forbidden-matrix.test.ts, applied to the five
 * administrator routes and the one public one. Asserted in BOTH directions:
 * who is refused, and who is allowed. A guard that refuses everyone passes
 * every refusal test perfectly, which is why the allow cases are here too.
 *
 * The public route is the interesting row. It must be reachable by somebody
 * with no session — that is its whole purpose — while granting that caller
 * nothing else.
 */

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

requireTestEnv();
const prisma = makeTestPrisma();

const DUMMY_ID = '00000000-0000-4000-8000-000000000000';

let admin: TestPrincipal & { password: string };
let supervisor: TestPrincipal & { password: string };
let readOnly: TestPrincipal & { password: string };
let officer: TestPrincipal & { password: string };

beforeAll(async () => {
  await sweep(prisma);
  admin = await createPrincipal(prisma, 'admin');
  supervisor = await createPrincipal(prisma, 'supervisor', { stateId: 'CE' });
  readOnly = await createPrincipal(prisma, 'read_only', { stateId: 'CE' });
  officer = await createPrincipal(prisma, 'officer', { payamId: 'CE-JUB-MUN' });
});

afterAll(async () => {
  await sweep(prisma);
  await prisma.$disconnect();
});

const principals = () => ({ admin, supervisor, read_only: readOnly, officer });

/** Every administrator-only route added by Prompt 13. */
const ADMIN_ROUTES = [
  {
    name: 'POST /api/admin/communications',
    mod: communications,
    method: 'POST' as const,
    body: () => ({
      channel: 'email',
      recipient_type: 'staff',
      recipient_ids: [randomUUID()],
      subject: 'Zztest subject',
      body: 'Zztest body',
    }),
  },
  { name: 'GET /api/admin/product-reports', mod: adminQueue, method: 'GET' as const },
  {
    name: 'GET /api/admin/product-reports/:id',
    mod: adminDetail,
    method: 'GET' as const,
    params: () => ({ id: DUMMY_ID }),
  },
  {
    name: 'PATCH /api/admin/product-reports/:id',
    mod: adminDetail,
    method: 'PATCH' as const,
    params: () => ({ id: DUMMY_ID }),
    body: () => ({ action: 'mark_reviewing' }),
  },
  { name: 'GET /api/admin/product-reports/unread-count', mod: unreadCount, method: 'GET' as const },
];

describe('no session reaches any administrator route', () => {
  it.each(ADMIN_ROUTES.map((r) => [r.name, r]))(
    '%s returns 401 with no session',
    async (_n, route) => {
      const r = route as (typeof ADMIN_ROUTES)[number];
      const result = await call(r.mod, r.method, {
        as: null,
        params: r.params?.(),
        body: r.body?.(),
      });
      expect(result.status, `${r.name} let an unauthenticated caller through`).toBe(401);
    },
  );

  it.each(ADMIN_ROUTES.map((r) => [r.name, r]))(
    '%s returns 401 with a junk token',
    async (_n, route) => {
      const r = route as (typeof ADMIN_ROUTES)[number];
      const result = await call(r.mod, r.method, {
        as: { accessToken: 'not-a-real-token' } as TestPrincipal,
        params: r.params?.(),
        body: r.body?.(),
      });
      expect(result.status).toBe(401);
    },
  );
});

describe('roles that may not, do not', () => {
  const cases = ADMIN_ROUTES.flatMap((r) =>
    (['supervisor', 'read_only', 'officer'] as const).map(
      (role) => [`${r.name} rejects ${role}`, r, role] as const,
    ),
  );

  it.each(cases.map((c) => [c[0], c[1], c[2]]))('%s', async (_n, route, role) => {
    const r = route as (typeof ADMIN_ROUTES)[number];
    const who = principals()[role as keyof ReturnType<typeof principals>];
    const result = await call(r.mod, r.method, { as: who, params: r.params?.(), body: r.body?.() });
    expect(result.status, `${r.name} let ${role} through`).toBe(403);
    expect(result.body).toMatchObject({ error: { code: 'forbidden' } });
  });
});

describe('the administrator may', () => {
  it('read the queue', async () => {
    expect((await call(adminQueue, 'GET', { as: admin })).status).toBe(200);
  });

  it('read the unread count', async () => {
    expect((await call(unreadCount, 'GET', { as: admin })).status).toBe(200);
  });

  it('is not refused the detail route — an unknown id is 404, not 403', async () => {
    // The distinction proves authorization passed and only the record was
    // missing. A 403 here would mean the admin was being refused the route.
    const result = await call(adminDetail, 'GET', { as: admin, params: { id: DUMMY_ID } });
    expect(result.status).toBe(404);
  });
});

describe('the one public route', () => {
  it('is reachable with no session', async () => {
    // 404 because the listing is fictional — NOT 401. Reaching the handler at
    // all is what is being proved.
    const result = await call(submit, 'POST', {
      as: null,
      params: { id: DUMMY_ID },
      body: { reason: 'other' },
    });
    expect(result.status).not.toBe(401);
    expect(result.status).toBe(404);
  });

  it('behaves identically for a signed-in non-admin', async () => {
    // A session neither helps nor hinders: the route scopes nothing and grants
    // nothing, so a supervisor gets exactly what a stranger gets.
    const anonymous = await call(submit, 'POST', {
      as: null,
      params: { id: DUMMY_ID },
      body: { reason: 'other' },
    });
    const signedIn = await call(submit, 'POST', {
      as: supervisor,
      params: { id: DUMMY_ID },
      body: { reason: 'other' },
    });
    expect(signedIn.status).toBe(anonymous.status);
    expect(signedIn.text).toBe(anonymous.text);
  });

  it('refuses a malformed body from anyone', async () => {
    const result = await call(submit, 'POST', {
      as: null,
      params: { id: DUMMY_ID },
      body: { nonsense: true },
    });
    expect(result.status).toBe(400);
  });

  it('grants no read of anything', async () => {
    // The module defines POST only; every other method is 405, so the public
    // declaration cannot be used to read the queue.
    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const result = await call(submit, method, { as: null, params: { id: DUMMY_ID } });
      expect(result.status, `${method} was served on the public route`).toBe(405);
    }
  });
});

describe('every response carries a correlation id', () => {
  it.each(ADMIN_ROUTES.map((r) => [r.name, r]))('%s, even when refusing', async (_n, route) => {
    const r = route as (typeof ADMIN_ROUTES)[number];
    const result = await call(r.mod, r.method, {
      as: null,
      params: r.params?.(),
      body: r.body?.(),
    });
    expect(result.headers.get('x-correlation-id')).toBeTruthy();
  });
});
