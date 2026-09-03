import * as Sentry from '@sentry/nextjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notFound } from '../lib/api/errors';
import { defineRoutes, ok } from '../lib/api/route';

/**
 * A ROUTE FAILURE IS REPORTED, NOT SWALLOWED.
 *
 * The wrapper catches every error a handler throws, so Next's own
 * onRequestError hook never sees it. That means the wrapper is the ONLY place a
 * server-side route failure can be reported from. The first version of it wrote
 * to the console and nothing else, while its comment said Sentry was informed.
 * Error reporting was silently off for every route.
 *
 * Both directions, per the standing rule: an unexpected error IS reported, and
 * a documented outcome for the caller (404, 422 ...) is NOT -- an officer's 404
 * is not an incident, and reporting those would bury the real ones.
 */

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

// No Supabase round trip: the wrapper's authentication is proved elsewhere.
vi.mock('../lib/api/require-role', () => ({
  requireRole: vi.fn(async () => ({
    principal: { kind: 'user', id: 'zztest-id', authUserId: 'zztest-auth', name: 'zztest' },
    role: 'admin',
    scope: { kind: 'all' },
  })),
}));

const captured = vi.mocked(Sentry.captureException);

const call = async (routes: ReturnType<typeof defineRoutes>) => {
  const response = await routes.GET(new Request('http://localhost/api/test'), {
    params: Promise.resolve({}),
  });
  return { response, body: await response.json() };
};

beforeEach(() => captured.mockClear());

describe('the wrapper reports what it catches', () => {
  it('an unexpected error inside a handler is reported to Sentry once', async () => {
    const boom = new Error('the database fell over');
    const routes = defineRoutes({
      GET: {
        roles: ['admin'],
        handler: async () => {
          throw boom;
        },
      },
    });

    const { response, body } = await call(routes);

    expect(captured).toHaveBeenCalledTimes(1);
    expect(captured.mock.calls[0]?.[0]).toBe(boom);

    // ...and the caller gets the fixed sentence, never the detail.
    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: 'internal_error', message: 'Something went wrong. Please try again.' },
    });
    expect(JSON.stringify(body)).not.toContain('fell over');
  });

  it('the report carries the correlation id the caller was given', async () => {
    const routes = defineRoutes({
      GET: {
        roles: ['admin'],
        handler: async () => {
          throw new Error('x');
        },
      },
    });

    const { response } = await call(routes);
    const idOnResponse = response.headers.get('x-correlation-id');
    const idOnReport = (captured.mock.calls[0]?.[1] as { tags?: { correlation_id?: string } })?.tags
      ?.correlation_id;

    expect(idOnResponse).toBeTruthy();
    expect(idOnReport).toBe(idOnResponse);
  });

  it('a documented outcome for the caller is NOT reported', async () => {
    // The other direction. A 404 is the caller asking for something they may
    // not have; it is not an incident in our code.
    const routes = defineRoutes({
      GET: {
        roles: ['admin'],
        handler: async () => {
          throw notFound();
        },
      },
    });

    const { response } = await call(routes);

    expect(response.status).toBe(404);
    expect(captured).not.toHaveBeenCalled();
  });

  it('a successful request reports nothing, so the report is not noise', async () => {
    const routes = defineRoutes({
      GET: { roles: ['admin'], handler: async () => ok({ fine: true }) },
    });

    const { response } = await call(routes);

    expect(response.status).toBe(200);
    expect(captured).not.toHaveBeenCalled();
  });
});
