import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import * as communications from '../apps/web/app/api/admin/communications/route';
import {
  FARMER_TEST_FAMILY,
  type TestPrincipal,
  createPrincipal,
  sweep,
} from './helpers/principals';
import { makeTestPrisma, requireTestEnv } from './helpers/db';
import { call } from './helpers/request';

/**
 * ============================================================================
 * ADMINISTRATOR EMAIL, AGAINST THE REAL DATABASE AND A STUBBED PROVIDER.
 * ============================================================================
 *
 * No real email is sent. `fetch` is stubbed at the boundary Resend is called
 * through, so the route's own behaviour is exercised for real — authorization,
 * recipient resolution, audit — while nothing leaves the building.
 *
 * THE POINT OF MOST OF THESE TESTS: a browser must never be able to choose
 * where a message goes. The request carries record ids; the server reads the
 * address itself.
 */

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

requireTestEnv();
const prisma = makeTestPrisma();

let admin: TestPrincipal & { password: string };
let supervisor: TestPrincipal & { password: string };
let recipient: TestPrincipal & { password: string };

const realFetch = globalThis.fetch;

/** Captures what would have gone to Resend, and answers as we tell it to. */
function stubProvider(status: number, body: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://api.resend.com')) {
      calls.push({ url, init: init ?? {} });
      return new Response(JSON.stringify(body), { status });
    }
    // Everything else — Supabase auth, storage — goes to the real network.
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
  return calls;
}

const withConfig = <T>(run: () => Promise<T>): Promise<T> => {
  process.env.RESEND_API_KEY = 'zztest-not-a-real-key';
  process.env.EMAIL_FROM = 'zztest@example.invalid';
  return run();
};

beforeAll(async () => {
  await sweep(prisma);
  admin = await createPrincipal(prisma, 'admin');
  supervisor = await createPrincipal(prisma, 'supervisor', { stateId: 'CE' });
  recipient = await createPrincipal(prisma, 'read_only', { stateId: 'CE' });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await sweep(prisma);
  await prisma.$disconnect();
});

const send = (as: TestPrincipal | null, body: unknown) =>
  call(communications, 'POST', { as, body });

const valid = () => ({
  channel: 'email',
  recipient_type: 'staff',
  recipient_ids: [recipient.id],
  subject: 'Zztest quarterly briefing',
  body: 'Zztest message body about nothing in particular.',
});

describe('configuration is reported, never worked around', () => {
  it('refuses with 503 when no key is set, and sends nothing', async () => {
    const calls = stubProvider(200);
    const result = await send(admin, valid());
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: 'email_not_configured' } });
    expect(calls, 'the provider was called with no key configured').toHaveLength(0);
  });

  it('refuses when the sender address is missing', async () => {
    process.env.RESEND_API_KEY = 'zztest-not-a-real-key';
    const calls = stubProvider(200);
    const result = await send(admin, valid());
    expect(result.status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});

describe('the browser cannot choose a destination', () => {
  it('refuses a body carrying an email address', async () => {
    // The schema is strict, so an address cannot even be attached "as a hint".
    const result = await withConfig(async () => {
      stubProvider(200);
      return send(admin, { ...valid(), to: 'attacker@example.invalid' });
    });
    expect(result.status).toBe(400);
  });

  it('sends to the address the SERVER resolved, not one it was given', async () => {
    const calls = await withConfig(async () => {
      const captured = stubProvider(200, { id: 'zztest-provider-id' });
      const result = await send(admin, valid());
      expect(result.status).toBe(200);
      return captured;
    });
    expect(calls).toHaveLength(1);
    const sent = JSON.parse(String(calls[0]!.init.body)) as { to: string[]; from: string };
    // The recipient's real auth address, which the client never saw.
    expect(sent.to).toHaveLength(1);
    expect(sent.to[0]).not.toBe('attacker@example.invalid');
    expect(sent.from).toBe('zztest@example.invalid');
  });

  it('refuses a farmer or an officer as an email recipient', async () => {
    for (const recipient_type of ['farmer', 'officer']) {
      const result = await withConfig(async () => {
        stubProvider(200);
        return send(admin, { ...valid(), recipient_type });
      });
      expect(result.status, `${recipient_type} was accepted for email`).toBe(400);
    }
  });

  it('counts an unknown recipient as unreachable rather than failing the send', async () => {
    const result = await withConfig(async () => {
      stubProvider(200);
      return send(admin, { ...valid(), recipient_ids: [recipient.id, randomUUID()] });
    });
    expect(result.status).toBe(200);
    const data = result.body.data as { requested: number; accepted: number; unreachable: number };
    expect(data.requested).toBe(2);
    expect(data.unreachable).toBe(1);
  });
});

describe('one request per recipient, so nobody sees the list', () => {
  it('sends separately to each address', async () => {
    const second = await createPrincipal(prisma, 'read_only', { stateId: 'CE' });
    const calls = await withConfig(async () => {
      const captured = stubProvider(200);
      const result = await send(admin, {
        ...valid(),
        recipient_ids: [recipient.id, second.id],
      });
      expect(result.status).toBe(200);
      return captured;
    });
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      const sent = JSON.parse(String(c.init.body)) as { to: string[] };
      expect(sent.to, 'more than one address in a single provider request').toHaveLength(1);
    }
  });
});

describe('the provider decides the outcome, and the route reports it', () => {
  it('reports a refusal as failed, not as sent', async () => {
    const result = await withConfig(async () => {
      stubProvider(422, { message: 'Zztest refusal' });
      return send(admin, valid());
    });
    expect(result.status).toBe(200);
    expect((result.body.data as { failed: number; accepted: number }).failed).toBe(1);
    expect((result.body.data as { accepted: number }).accepted).toBe(0);
  });

  it('reports an outage as 503, never as success and never as 401', async () => {
    const result = await withConfig(async () => {
      stubProvider(500);
      return send(admin, valid());
    });
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: 'email_unavailable' } });
  });
});

describe('validation', () => {
  it('refuses an empty subject, an empty body and no recipients', async () => {
    for (const patch of [{ subject: '' }, { body: '' }, { recipient_ids: [] }]) {
      const result = await withConfig(async () => {
        stubProvider(200);
        return send(admin, { ...valid(), ...patch });
      });
      expect(result.status, `${JSON.stringify(patch)} was accepted`).toBe(400);
    }
  });
});

describe('the audit row records the act, not the message', () => {
  it('writes email_sent with counts and a subject, and no body', async () => {
    await withConfig(async () => {
      stubProvider(200);
      return send(admin, valid());
    });
    const rows = await prisma.$queryRawUnsafe<{ action: string; after: unknown }[]>(
      `SELECT action, after FROM public.audit_event
        WHERE action = 'communication.email_sent' AND actor_id = $1::uuid
        ORDER BY occurred_at DESC LIMIT 1`,
      admin.id,
    );
    expect(rows).toHaveLength(1);
    const payload = JSON.stringify(rows[0]?.after);
    expect(payload).toContain('Zztest quarterly briefing');
    expect(payload, 'the message body reached the audit log').not.toContain(
      'about nothing in particular',
    );
    expect(payload).not.toContain('zztest-not-a-real-key');
    expect(payload).not.toMatch(/@/); // no address of any kind
  });

  it('records the outage too, so "we tried" is answerable later', async () => {
    await withConfig(async () => {
      stubProvider(503);
      return send(admin, valid());
    });
    const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.audit_event
        WHERE action = 'communication.send_failed' AND actor_id = $1::uuid`,
      admin.id,
    );
    expect(rows[0]!.n).toBeGreaterThan(0);
  });
});

describe('authorization', () => {
  it('refuses a supervisor', async () => {
    const result = await withConfig(async () => {
      stubProvider(200);
      return send(supervisor, valid());
    });
    expect(result.status).toBe(403);
  });

  it('refuses no session', async () => {
    const result = await withConfig(async () => {
      stubProvider(200);
      return send(null, valid());
    });
    expect(result.status).toBe(401);
  });
});

void FARMER_TEST_FAMILY;
