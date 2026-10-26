/**
 * THE SMS PROVIDER (BIRD), SERVER-SIDE ONLY. Deliverable (n).
 *
 * Modelled on `lib/email/resend.ts`, and the same three promises hold:
 *
 *   1. THE GUARD BELOW IS THE GUARANTEE. This module refuses to load in a
 *      browser, so the key cannot reach a bundle even by a wrong import.
 *   2. NO SDK. Bird is called over its REST API with `fetch`, exactly as
 *      `scripts/bird-sms-verify.mjs` does: `POST {base}/v1/sms/messages` with
 *      `to`, `from`, `text` and `category`. No new dependency.
 *   3. NOTHING HERE INVENTS AN OUTCOME. A missing or malformed setting is a
 *      configuration failure; an unreachable provider, a deadline, a rate
 *      limit or a refused credential is unavailability; a refusal of one
 *      message is a refusal. `accepted` means Bird took the message — never
 *      that a handset received it. Delivery is a later event Bird reports
 *      separately, and a carrier can still refuse an accepted message.
 *
 * THE SENDER IS CONFIGURATION, NOT CODE. `BIRD_SMS_SENDER_ID` is the
 * alphanumeric sender already set up in CORWADO's Bird account. Bird lists an
 * alphanumeric sender as the only sender type for South Sudan (+211), which is
 * why nothing here accepts a phone number as the sender.
 */

if (typeof window !== 'undefined') {
  // Never reached in a correct build. Failing here is far cheaper than a
  // provider key reaching a browser bundle.
  throw new Error('lib/sms/bird is server-only and must never be imported by a client.');
}

export interface SmsConfig {
  apiKey: string;
  baseUrl: string;
  senderId: string;
}

export class SmsNotConfiguredError extends Error {
  /** Names of the settings that are missing or malformed. Never their values. */
  constructor(readonly problems: string[]) {
    super(`The SMS service is not configured: ${problems.join(', ')}.`);
    this.name = 'SmsNotConfiguredError';
  }
}

export class SmsUnavailableError extends Error {
  constructor(message = 'The SMS service could not be reached.') {
    super(message);
    this.name = 'SmsUnavailableError';
  }
}

/** 3 to 11 letters, digits, spaces, dashes or underscores, at least one letter. */
const SENDER_ID = /^(?=.*[A-Za-z])[A-Za-z0-9 _-]{3,11}$/;

/**
 * Reads the configuration, or says exactly which settings are wrong — by NAME.
 *
 * Not cached at module scope: a deployment that adds the key should not need a
 * restart to be believed, and a test can set and unset it.
 *
 * THE REGION CHECK COMPARES TWO SOURCES BEFORE ANYTHING IS SENT. A Bird key is
 * `bk_{region}_…` and only works against its own region's host. The verify
 * script learned this the expensive way: Bird answered a mismatch with 401
 * "InvalidAPIKey", which reads as a wrong key rather than a wrong host.
 */
export function smsConfig(): SmsConfig {
  const apiKey = process.env.BIRD_API_KEY ?? '';
  const rawBase = process.env.BIRD_API_BASE_URL ?? '';
  const senderId = process.env.BIRD_SMS_SENDER_ID ?? '';
  const problems: string[] = [];

  if (!apiKey) problems.push('BIRD_API_KEY not set');
  if (!rawBase) problems.push('BIRD_API_BASE_URL not set');
  if (!senderId) problems.push('BIRD_SMS_SENDER_ID not set');

  const baseUrl = rawBase.replace(/\/+$/, '');
  if (rawBase && !/^https:\/\/[a-z0-9.-]+$/i.test(baseUrl)) {
    problems.push('BIRD_API_BASE_URL is not an https host');
  }
  if (senderId && !SENDER_ID.test(senderId)) {
    problems.push('BIRD_SMS_SENDER_ID is not a 3-11 character alphanumeric sender');
  }
  if (apiKey && baseUrl) {
    const keyRegion = /^bk_([a-z0-9]+)_/.exec(apiKey)?.[1];
    const hostRegion = /^https:\/\/([a-z0-9]+)\./.exec(baseUrl)?.[1];
    if (keyRegion && hostRegion && keyRegion !== hostRegion) {
      problems.push('BIRD_API_KEY and BIRD_API_BASE_URL name different regions');
    }
  }

  if (problems.length > 0) throw new SmsNotConfiguredError(problems);
  return { apiKey, baseUrl, senderId };
}

export const smsIsConfigured = (): boolean => {
  try {
    smsConfig();
    return true;
  } catch {
    return false;
  }
};

/** Ten seconds, then unavailable — a hung provider must not hang the route. */
export const SMS_DEADLINE_MS = 10_000;

/**
 * Bird's four categories are transactional, marketing, authentication and
 * service. An agricultural advisory or notice is `service`. `authentication`
 * was tried once by the verify script and carriers filter that class hardest.
 */
const CATEGORY = 'service';

export interface SendOneSmsResult {
  accepted: boolean;
  /** Bird's message id when accepted. Not a delivery receipt. */
  messageId?: string;
  /** Bird's own short reason when it refused. Never the key, never a header. */
  error?: string;
  /** 2026-10-26: Bird's RateLimit header -- sends left and seconds to reset -- when present. */
  rateLimit?: RateLimitState | null;
}

/**
 * RATE LIMITS (2026-10-26, DOCUMENTED: bird.com/docs/guides/rate-limits).
 * Bird sends `RateLimit: "<policy>";r=<remaining>;t=<seconds to reset>` (IETF
 * structured fields) on responses, and a 429 with `Retry-After` in seconds
 * when a policy is exhausted -- or when an abuse or supplier protection
 * trips, even with capacity left, so Retry-After is what to wait for.
 */
export interface RateLimitState {
  remaining: number;
  resetSeconds: number;
}

/** The tightest policy in a RateLimit header, or null when absent or unreadable. */
export function parseRateLimit(header: string | null | undefined): RateLimitState | null {
  if (!header) return null;
  let best: RateLimitState | null = null;
  for (const item of header.split(',')) {
    const r = /;\s*r=(\d+)/.exec(item)?.[1];
    const t = /;\s*t=(\d+)/.exec(item)?.[1];
    if (r === undefined || t === undefined) continue;
    const state = { remaining: Number(r), resetSeconds: Number(t) };
    if (!best || state.remaining < best.remaining) best = state;
  }
  return best;
}

/** Retry-After in whole seconds (delta-seconds or an HTTP date), or null. Capped at an hour. */
export function parseRetryAfter(
  header: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Math.min(Number(trimmed), 3600);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, Math.ceil((at - nowMs) / 1000)), 3600);
}

/**
 * Bird refused for rate: wait `retryAfterSeconds` (when it said) before the
 * next send. A kind of unavailability, so callers that stop on unavailability
 * still stop; the announcement batch instead pauses and puts the row back.
 */
export class SmsRateLimitedError extends SmsUnavailableError {
  constructor(readonly retryAfterSeconds: number | null) {
    super('The SMS service asked us to slow down (429).');
    this.name = 'SmsRateLimitedError';
  }
}

/** A 429 that asks for no more than this is waited out once, inside the send. */
export const SMS_INLINE_RETRY_MAX_SECONDS = 3;

export interface SendOneSmsOptions {
  /**
   * 2026-10-26: Bird's Idempotency-Key (bird.com/docs/guides/idempotency):
   * a retry with the same key and body within three hours replays the first
   * answer instead of sending again. The announcement batch uses the
   * delivery row's id, so a delivery is billed once however often it is
   * retried. At most 255 characters.
   */
  idempotencyKey?: string;
}

/**
 * Sends one message to one E.164 number.
 *
 * ONE REQUEST PER RECIPIENT, as with email: nobody's number is disclosed to
 * anyone else, and one refusal does not sink the rest.
 *
 * A 401 or 403 is NOT a per-recipient refusal: the credential or its scope is
 * wrong, so every remaining message would be refused identically and billed
 * attention for nothing. It stops the send as unavailability.
 */
export async function sendOneSms(
  config: SmsConfig,
  to: string,
  text: string,
  options: SendOneSmsOptions = {},
): Promise<SendOneSmsResult> {
  const post = async (): Promise<Response> => {
    try {
      return await fetch(`${config.baseUrl}/v1/sms/messages`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
          ...(options.idempotencyKey
            ? { 'idempotency-key': options.idempotencyKey.slice(0, 255) }
            : {}),
        },
        body: JSON.stringify({ to, from: config.senderId, text, category: CATEGORY }),
        signal: AbortSignal.timeout(SMS_DEADLINE_MS),
      });
    } catch {
      // A network failure or the deadline. The provider did not answer at all,
      // which is different from refusing and different again from accepting.
      throw new SmsUnavailableError();
    }
  };

  let response = await post();
  // 2026-10-26: a short Retry-After is waited out once, with the same
  // Idempotency-Key and body, so it cannot send twice.
  if (response.status === 429) {
    const wait = parseRetryAfter(response.headers.get('retry-after'));
    if (wait !== null && wait <= SMS_INLINE_RETRY_MAX_SECONDS) {
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      response = await post();
    }
  }

  if (response.status === 401 || response.status === 403) {
    throw new SmsUnavailableError(
      `The SMS service refused the credential (${response.status}). Check the key and its sms:write scope.`,
    );
  }
  if (response.status === 429) {
    throw new SmsRateLimitedError(parseRetryAfter(response.headers.get('retry-after')));
  }
  // 409 E01004: the same key is still being processed (a parallel retry).
  // Not a refusal of the message, so it is treated like an outage: the row
  // goes back to the queue and the next attempt replays the first answer.
  if (response.status === 409 && options.idempotencyKey) {
    const peek = (await response
      .clone()
      .json()
      .catch(() => ({}))) as { error?: { code?: unknown } };
    if (peek.error?.code === 'E01004') {
      throw new SmsUnavailableError('The SMS service is still processing this message.');
    }
  }
  if (response.status >= 500) {
    throw new SmsUnavailableError(`The SMS service answered ${response.status}.`);
  }
  const rateLimit = parseRateLimit(response.headers.get('ratelimit'));

  const body = (await response.json().catch(() => ({}))) as {
    id?: unknown;
    message?: unknown;
    code?: unknown;
  };

  if (!response.ok) {
    const reason =
      typeof body.message === 'string'
        ? body.message
        : typeof body.code === 'string'
          ? body.code
          : `Refused (${response.status}).`;
    return { accepted: false, error: reason.slice(0, 200), rateLimit };
  }

  return typeof body.id === 'string'
    ? { accepted: true, messageId: body.id, rateLimit }
    : { accepted: true, rateLimit };
}

/** Unavailability part-way through a batch, carrying what went out before it. */
export class SmsBatchInterruptedError extends SmsUnavailableError {
  constructor(
    message: string,
    readonly accepted: number,
    readonly refused: number,
  ) {
    super(message);
    this.name = 'SmsBatchInterruptedError';
  }
}

export const SMS_CONCURRENCY = 8;

/**
 * Sends one text to many numbers, a few at a time, and counts what happened.
 *
 * Bounded concurrency so five hundred recipients finish inside a serverless
 * function's lifetime without opening five hundred sockets at once. When the
 * provider becomes unavailable, nothing new is started, the messages already
 * in flight are allowed to finish, and the error is rethrown carrying the
 * counts so the caller can audit exactly what went out before the outage.
 */
export async function sendSmsBatch(
  config: SmsConfig,
  numbers: readonly string[],
  text: string,
): Promise<{ accepted: string[]; refused: string[] }> {
  const accepted: string[] = [];
  const refused: string[] = [];
  let next = 0;
  let stopped: SmsUnavailableError | null = null;

  const worker = async () => {
    while (!stopped && next < numbers.length) {
      const to = numbers[next++] as string;
      try {
        const result = await sendOneSms(config, to, text);
        (result.accepted ? accepted : refused).push(to);
      } catch (failure) {
        if (failure instanceof SmsUnavailableError) stopped ??= failure;
        else throw failure;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SMS_CONCURRENCY, numbers.length) }, () => worker()),
  );

  if (stopped) {
    throw new SmsBatchInterruptedError(
      (stopped as SmsUnavailableError).message,
      accepted.length,
      refused.length,
    );
  }
  return { accepted, refused };
}
