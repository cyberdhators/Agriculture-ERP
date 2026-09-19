import { describe, expect, it, vi } from 'vitest';

import { defineRoutes, ok } from './route';

/**
 * THE HIGHEST-PRIORITY TEST IN THIS MODULE.
 *
 * `roles: 'public'` was added to the route wrapper so that a marketplace
 * visitor with no account can report a listing. The wrapper is what enforces
 * authorization on every route in this system, so the question is not "does
 * the public route work" but "can anything ELSE become public by accident".
 *
 * Three ways that could happen, and all three are asserted below:
 *   1. a route omits `roles` entirely;
 *   2. a route declares `roles: []`, which reads like "no restriction";
 *   3. some existing route is quietly changed to `'public'`.
 *
 * The first two must reach no handler. The third is caught by the scan in
 * public-route-scan.test.ts, which counts the public declarations on disk.
 */

const call = async (
  handler: (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>,
) =>
  handler(new Request('https://example.invalid/api/thing', { method: 'GET' }), {
    params: Promise.resolve({}),
  });

describe('a route is public only when it says so', () => {
  it('runs the handler with no session when it declares roles: public', async () => {
    const handler = vi.fn().mockResolvedValue(ok({ reached: true }));
    const routes = defineRoutes({ GET: { roles: 'public', handler } });

    const response = await call(routes.GET);

    expect(handler).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });

  it('an EMPTY ROLES ARRAY is not public, and reaches no handler', async () => {
    // The failure this guards: `roles: []` reads like "nobody is excluded" and
    // is what a mistake looks like. It must behave as "nobody is allowed".
    const handler = vi.fn().mockResolvedValue(ok({ reached: true }));
    const routes = defineRoutes({ GET: { roles: [], handler } });

    const response = await call(routes.GET);

    expect(handler, 'an empty roles array let a caller through').not.toHaveBeenCalled();
    expect(response.status).not.toBe(200);
  });

  it('a named role still reaches no handler without a session', async () => {
    const handler = vi.fn().mockResolvedValue(ok({ reached: true }));
    const routes = defineRoutes({ GET: { roles: ['admin'], handler } });

    const response = await call(routes.GET);

    expect(handler, 'an admin route ran for an unauthenticated caller').not.toHaveBeenCalled();
    expect(response.status).not.toBe(200);
  });

  it('every non-public role list refuses an unauthenticated caller', async () => {
    for (const roles of [
      ['admin'],
      ['supervisor'],
      ['read_only'],
      ['officer'],
      ['admin', 'supervisor', 'read_only', 'officer'],
    ] as const) {
      const handler = vi.fn().mockResolvedValue(ok({ reached: true }));
      const routes = defineRoutes({ GET: { roles: [...roles], handler } });
      await call(routes.GET);
      expect(handler, `${roles.join('+')} ran without a session`).not.toHaveBeenCalled();
    }
  });

  it('a method that was never defined is still 405, public or not', async () => {
    const routes = defineRoutes({ GET: { roles: 'public', handler: async () => ok({}) } });
    const response = await call(routes.POST);
    expect(response.status).toBe(405);
  });

  it('a public route still carries a correlation id', async () => {
    const routes = defineRoutes({ GET: { roles: 'public', handler: async () => ok({}) } });
    const response = await call(routes.GET);
    expect(response.headers.get('x-correlation-id')).toBeTruthy();
  });
});
