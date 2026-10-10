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
): Promise<SendOneSmsResult> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/v1/sms/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ to, from: config.senderId, text, category: CATEGORY }),
      signal: AbortSignal.timeout(SMS_DEADLINE_MS),
    });
  } catch {
    // A network failure or the deadline. The provider did not answer at all,
    // which is different from refusing and different again from accepting.
    throw new SmsUnavailableError();
  }

  if (response.status === 401 || response.status === 403) {
    throw new SmsUnavailableError(
      `The SMS service refused the credential (${response.status}). Check the key and its sms:write scope.`,
    );
  }
  if (response.status === 429 || response.status >= 500) {
    throw new SmsUnavailableError(`The SMS service answered ${response.status}.`);
  }

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
    return { accepted: false, error: reason.slice(0, 200) };
  }

  return typeof body.id === 'string' ? { accepted: true, messageId: body.id } : { accepted: true };
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
