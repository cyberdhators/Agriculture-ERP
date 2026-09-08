import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as me from '../apps/web/app/api/me/route';
import { ERROR_MESSAGES } from '../packages/shared/src/errors';
import { makeTestPrisma, requireTestEnv } from './helpers/db';
import { type TestPrincipal, createPrincipal, sweep } from './helpers/principals';
import { call } from './helpers/request';

/**
 * B6.5: an outage of the sign-in service is 503 auth_unavailable, never 401.
 * Both directions, with a real failing service rather than a mock: a port
 * nobody listens on, a server that answers 503, one that answers 429, one
 * that never answers; and, against the real service, a junk token is still
 * 401 and a real session is still 200.
 */
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
requireTestEnv();
const prisma = makeTestPrisma();
const REAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
let admin: TestPrincipal & { password: string };
let server: Server | undefined;
let mode: 'http503' | 'http429' | 'hang' = 'http503';

const startFake = (): Promise<string> =>
  new Promise((resolve) => {
    server = createServer((req, res) => {
      if (mode === 'hang') return; // never answers; the deadline must answer for it
      res.writeHead(mode === 'http503' ? 503 : 429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'fake outage', code: mode }));
      void req;
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
    });
  });

beforeAll(async () => {
  await sweep(prisma);
  admin = await createPrincipal(prisma, 'admin');
});
afterAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = REAL_URL;
  server?.close();
  await sweep(prisma);
  await prisma.$disconnect();
});

const withServiceAt = async (url: string, fn: () => Promise<void>) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  try {
    await fn();
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = REAL_URL;
  }
};

describe('the sign-in service failing is 503, not 401 (B6.5)', () => {
  it('unreachable: a port nobody listens on', async () => {
    await withServiceAt('http://127.0.0.1:9', async () => {
      const r = await call(me, 'GET', { as: admin });
      expect(r.status).toBe(503);
      expect(r.body).toEqual({
        error: { code: 'auth_unavailable', message: ERROR_MESSAGES.authUnavailable },
      });
    });
  });
  it('answering 503, and answering 429', async () => {
    const fake = await startFake();
    for (const m of ['http503', 'http429'] as const) {
      mode = m;
      await withServiceAt(fake, async () => {
        const r = await call(me, 'GET', { as: admin });
        expect(r.status, m).toBe(503);
        expect((r.body.error as { code: string }).code).toBe('auth_unavailable');
      });
    }
  });
  it('never answering: the ten-second deadline turns a hang into 503', async () => {
    const fake = await startFake();
    mode = 'hang';
    const started = Date.now();
    await withServiceAt(fake, async () => {
      const r = await call(me, 'GET', { as: admin });
      expect(r.status).toBe(503);
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(9_000);
    expect(elapsed).toBeLessThan(30_000);
  });
  it('the other direction: against the real service a junk token is still 401 and a real session is still 200', async () => {
    const junk = await call(me, 'GET', {
      as: { accessToken: 'not-a-real-token' } as TestPrincipal,
    });
    expect(junk.status).toBe(401);
    expect((junk.body.error as { message: string }).message).toBe(ERROR_MESSAGES.unauthenticated);
    const real = await call(me, 'GET', { as: admin });
    expect(real.status).toBe(200);
  });
});
