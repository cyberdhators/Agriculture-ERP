import type { ZodType } from '@agri-erp/shared';
import {
  ERROR_CODES,
  ERROR_MESSAGES,
  MAX_BODY_BYTES,
  type Role,
  apiError,
  isJsonMediaType,
  zodErrorToApiError,
  DEVICE_ID_HEADER,
  SYNC_MESSAGES,
  deviceIdSchema,
} from '@agri-erp/shared';
import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { ApiFailure, failureResponse, internalError } from './errors';
import { runWithRequestContext } from './request-context';
import { type Authenticated, requireRole } from './require-role';

/**
 * THE SHARED ROUTE WRAPPER. Every route in this project goes through it.
 *
 * It owns the things every route must do identically and must not restate:
 *
 *   - requireRole, before any data access
 *   - the Content-Type check           415  (CONVENTIONS section 9.1)
 *   - the body size cap                413  (section 9.2)
 *   - JSON parsing                     400  invalid_json
 *   - Zod failures in the documented shape  (section 4)
 *   - method not allowed               405  (section 5)
 *   - the fixed 500 sentence                (section 5.4)
 *   - a correlation id on every response
 *   - the success envelope                  (section 3)
 *
 * WHY A WRAPPER RATHER THAN A CHECKLIST. The B1.4 drift test locks the
 * documented sentences to the exported constants and nothing more: a route
 * returning 400 where 415 belongs leaves both tables matching and the test
 * green. Moving the order into one place means a route cannot get it wrong,
 * because a route never makes those decisions.
 *
 * WHY IT IS HARD TO SKIP. `defineRoutes` returns every HTTP method Next can
 * route, including 405 handlers for the ones you did not define, and stamps each
 * with ROUTE_MARKER. A route file that exports a raw handler is detectable, and
 * apps/web/tests/wrapper-enforced.test.ts walks app/api/**\/route.ts and fails
 * on any export without the mark. Writing a route that skips the wrapper means
 * writing a route that fails a test by existing.
 */

/** Stamped on every handler the wrapper produces. */
export const ROUTE_MARKER = Symbol.for('agri-erp.wrapped-route');

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

export type RouteResult =
  | {
      readonly kind: 'data';
      readonly data: unknown;
      readonly status?: number;
      readonly headers?: Record<string, string>;
      /**
       * CONVENTIONS §3.2. A warning is not an error: the write succeeded, and
       * `warnings` sits beside `data`, never inside an error body. Present only
       * when there is something to say.
       */
      readonly warnings?: Warnings;
    }
  | {
      readonly kind: 'page';
      readonly data: readonly unknown[];
      /**
       * `cursor` and `hasMore` are required by CONVENTIONS section 6.1. A route
       * may add diagnostic fields beside them -- the users list reports orphaned
       * authentication accounts this way.
       */
      readonly page: { cursor: string | null; hasMore: boolean } & Record<string, unknown>;
    }
  | { readonly kind: 'empty'; readonly status: number; readonly headers?: Record<string, string> };

/** A single object. `{ data: ... }` */
export const ok = (data: unknown, headers?: Record<string, string>): RouteResult =>
  headers ? { kind: 'data', data, headers } : { kind: 'data', data };

/** 201 with the created object. CONVENTIONS section 3. */
export const created = (data: unknown): RouteResult => ({ kind: 'data', data, status: 201 });

/** The documented warning shapes. Pinned in CONVENTIONS §3.2. */
export interface Warnings {
  /** Ids of existing farmers that matched (C-5.6). Ids only — the caller looks them up. */
  readonly duplicates?: readonly string[];
}

const withWarnings = (result: RouteResult, warnings: Warnings): RouteResult => {
  if (result.kind !== 'data') return result;
  const nonEmpty = Object.fromEntries(
    Object.entries(warnings).filter(([, v]) => Array.isArray(v) && v.length > 0),
  );
  return Object.keys(nonEmpty).length > 0 ? { ...result, warnings: nonEmpty } : result;
};
export const okWith = (data: unknown, warnings: Warnings): RouteResult =>
  withWarnings(ok(data), warnings);
export const createdWith = (data: unknown, warnings: Warnings): RouteResult =>
  withWarnings(created(data), warnings);

/** A list. `{ data: [...], page: { cursor, hasMore } }` -- section 6.1. */
export const paged = (
  data: readonly unknown[],
  page: { cursor: string | null; hasMore: boolean } & Record<string, unknown>,
): RouteResult => ({
  kind: 'page',
  data,
  page,
});

/** A body-less response, such as 304. */
export const empty = (status: number, headers?: Record<string, string>): RouteResult =>
  headers ? { kind: 'empty', status, headers } : { kind: 'empty', status };

export interface RouteContext<TBody> {
  readonly request: Request;
  /** Null only on a route declared `roles: 'public'`. */
  readonly auth: Authenticated;
  readonly body: TBody;
  readonly params: Record<string, string>;
  readonly correlationId: string;
  /** The device header (C-9.8), or null for a browser session. */
  readonly deviceId: string | null;
}

export interface RouteDefinition<TBody = undefined> {
  /**
   * Which roles may call this. There is no "any authenticated" shortcut by
   * accident.
   *
   * `'public'` is the ONE exception, and it is spelled out rather than implied
   * by an empty array — an empty array is what a mistake looks like, and it
   * must never mean "anyone". A public route is read by a person with no
   * account at all, so it gets no `auth` and can scope nothing: it must
   * therefore write only what it is given and read nothing it was not asked
   * for. There is exactly one such route (marketplace report submission) and
   * adding a second is a decision, not a convenience.
   */
  readonly roles: readonly Role[] | 'public';
  /** Present means a body is expected, validated by this schema before the handler runs. */
  readonly bodySchema?: ZodType<TBody>;
  readonly handler: (ctx: RouteContext<TBody>) => Promise<RouteResult>;
}

type NextRouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<NextResponse>;

function methodNotAllowed(correlationId: string): NextResponse {
  return NextResponse.json(
    apiError(ERROR_CODES.methodNotAllowed, ERROR_MESSAGES.methodNotAllowed),
    { status: 405, headers: { 'x-correlation-id': correlationId } },
  );
}

function respond(result: RouteResult, correlationId: string): NextResponse {
  const headers = {
    'x-correlation-id': correlationId,
    ...(('headers' in result && result.headers) || {}),
  };
  if (result.kind === 'empty') return new NextResponse(null, { status: result.status, headers });
  if (result.kind === 'page') {
    return NextResponse.json({ data: result.data, page: result.page }, { status: 200, headers });
  }
  const body =
    result.warnings !== undefined
      ? { data: result.data, warnings: result.warnings }
      : { data: result.data };
  return NextResponse.json(body, { status: result.status ?? 200, headers });
}

function wrap<TBody>(definition: RouteDefinition<TBody>): NextRouteHandler {
  const handler: NextRouteHandler = async (request, context) => {
    // Every response carries one, whatever happens below -- including a 500.
    // A header on some routes and not others is worse than none, because a
    // request with no id is indistinguishable from one that was never reported.
    const correlationId = request.headers.get('x-correlation-id') ?? randomUUID();

    try {
      // C-9.8: the device, if the request names one. A malformed header is a
      // 400 like any other malformed input; a missing one is a browser.
      const rawDevice = request.headers.get(DEVICE_ID_HEADER);
      let deviceId: string | null = null;
      if (rawDevice !== null) {
        const parsedDevice = deviceIdSchema.safeParse(rawDevice.trim());
        if (!parsedDevice.success) {
          throw new ApiFailure(400, ERROR_CODES.invalidInput, ERROR_MESSAGES.invalidInput, {
            [DEVICE_ID_HEADER]: SYNC_MESSAGES.deviceIdShape,
          });
        }
        deviceId = parsedDevice.data;
      }

      // 1. Authenticate and authorise BEFORE anything reads the body or the
      //    database. An unauthenticated caller learns nothing about the shape
      //    of the request they got wrong.
      //
      //    A route declared `roles: 'public'` skips this deliberately and
      //    receives no principal. Everything else is unchanged: every existing
      //    route passes an array and behaves exactly as before.
      const auth =
        definition.roles === 'public'
          ? (null as unknown as Authenticated)
          : await requireRole(request, definition.roles);

      // 2. The body, in the order CONVENTIONS section 9 fixes: what it claims
      //    to be, how big it claims to be, whether it can be read, whether it
      //    is valid.
      let body = undefined as TBody;
      if (definition.bodySchema) {
        if (!isJsonMediaType(request.headers.get('content-type'))) {
          throw new ApiFailure(
            415,
            ERROR_CODES.unsupportedMediaType,
            ERROR_MESSAGES.unsupportedMediaType,
          );
        }
        const declared = Number(request.headers.get('content-length') ?? '0');
        if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
          throw new ApiFailure(413, ERROR_CODES.payloadTooLarge, ERROR_MESSAGES.payloadTooLarge);
        }
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          throw new ApiFailure(400, ERROR_CODES.invalidJson, ERROR_MESSAGES.invalidJson);
        }
        const parsed = definition.bodySchema.safeParse(raw);
        if (!parsed.success) {
          const { body: errorBody } = zodErrorToApiError(parsed.error);
          throw new ApiFailure(
            400,
            errorBody.error.code,
            errorBody.error.message,
            errorBody.error.fields,
          );
        }
        body = parsed.data;
      }

      const params = (await context?.params) ?? {};
      // Every audit write inside the handler reads the device from here (C-9.8).
      return await runWithRequestContext({ correlationId, deviceId }, async () =>
        respond(
          await definition.handler({ request, auth, body, params, correlationId, deviceId }),
          correlationId,
        ),
      );
    } catch (failure) {
      // A documented outcome for the caller -- 401, 404, 422 and so on. Not an
      // error in our code, so it is NOT reported: an officer's 404 is not an
      // incident, and reporting them would bury the real ones.
      if (failure instanceof ApiFailure) return failureResponse(failure, correlationId);

      // Anything else is ours, not the caller's. This wrapper CATCHES the
      // error, so Next's own onRequestError hook never sees it -- which means
      // if it is not reported from here, it is not reported at all. The first
      // version of this block only wrote to the console, and its comment
      // claimed Sentry was informed. It was not. Server-side error reporting
      // was silently off for every route until the Sentry verification unit
      // was planned and the gap was noticed. See docs/DECISIONS.md.
      //
      // The correlation id goes with it, so the report can be matched to the
      // response the caller saw. The event passes through the scrubber like
      // every other -- no name, phone number or national id leaves here.
      Sentry.captureException(failure, { tags: { correlation_id: correlationId } });
      console.error(`[${correlationId}] unhandled route failure`, failure);

      // The caller gets the fixed sentence and nothing else.
      return failureResponse(internalError(), correlationId);
    }
  };

  return Object.defineProperty(handler, ROUTE_MARKER, { value: true, enumerable: false });
}

/**
 * A definition with its body type erased.
 *
 * Each method's body type must infer from its OWN bodySchema, so the container
 * cannot name a single one. `never` makes every schema unassignable and
 * `unknown` loses the handler's parameter type, so the body slot is deliberately
 * open here and recovered by inference at each call site.
 */
type AnyRouteDefinition = {
  readonly roles: readonly Role[] | 'public';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly bodySchema?: ZodType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly handler: (ctx: RouteContext<any>) => Promise<RouteResult>;
};

/**
 * Defines a route file's handlers. Methods you do not define return the
 * documented 405 rather than whatever the framework would do.
 */
export function defineRoutes(
  definitions: Partial<{ [M in HttpMethod]: AnyRouteDefinition }>,
): Record<HttpMethod, NextRouteHandler> {
  const out = {} as Record<HttpMethod, NextRouteHandler>;
  for (const method of HTTP_METHODS) {
    const definition = definitions[method];
    if (definition) {
      out[method] = wrap(definition as RouteDefinition<never>);
    } else {
      const refuse: NextRouteHandler = async (request) =>
        methodNotAllowed(request.headers.get('x-correlation-id') ?? randomUUID());
      out[method] = Object.defineProperty(refuse, ROUTE_MARKER, { value: true, enumerable: false });
    }
  }
  return out;
}
