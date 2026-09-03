import type { TestPrincipal } from './principals';

/**
 * Calls a route handler as a principal, or as nobody.
 *
 * Handlers are imported and invoked directly rather than over HTTP. That is
 * deliberate: it exercises requireRole for real -- the bearer token is verified
 * against Supabase over the network -- without needing a server running, so the
 * matrix is the same in a test run and in CI if credentials are ever present.
 */

export interface RouteModule {
  GET?: Handler;
  POST?: Handler;
  PUT?: Handler;
  PATCH?: Handler;
  DELETE?: Handler;
}

type Handler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

export interface CallOptions {
  readonly as?: TestPrincipal | null;
  readonly body?: unknown;
  readonly params?: Record<string, string>;
  readonly query?: Record<string, string>;
  readonly headers?: Record<string, string>;
}

export interface CallResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers: Headers;
  /** The raw text, for asserting two responses are byte-identical. */
  readonly text: string;
}

export async function call(
  module_: RouteModule,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  options: CallOptions = {},
): Promise<CallResult> {
  const handler = module_[method];
  if (!handler) throw new Error(`Route has no ${method} export.`);

  const url = new URL('http://localhost/api/test');
  for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);

  const headers: Record<string, string> = { ...options.headers };
  if (options.as) headers.authorization = `Bearer ${options.as.accessToken}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await handler(
    new Request(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { params: Promise.resolve(options.params ?? {}) },
  );

  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* body-less responses */
  }
  return { status: response.status, body, headers: response.headers, text };
}
