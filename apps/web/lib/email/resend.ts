/**
 * THE EMAIL PROVIDER, SERVER-SIDE ONLY.
 *
 * THE GUARD BELOW IS THE GUARANTEE. The `server-only` package would turn a
 * client import into a build error, but it is not a dependency here and this
 * work adds none — so the module refuses to load in a browser instead. Nothing
 * imports it from a component, a test asserts that, and if something ever
 * does, it fails loudly at the first import rather than shipping a key.
 *
 * Resend is called over its REST API with `fetch` rather than
 * through its SDK — no new dependency, nothing to install on a machine whose
 * registry runs at 112 KB/s, and one fewer package with access to the key.
 *
 * NOTHING HERE INVENTS AN OUTCOME. A missing key or sender is a configuration
 * failure and is reported as one; an unreachable provider is 503; a rejection
 * is a rejection. There is no branch that returns success without the provider
 * having accepted the message.
 */

if (typeof window !== 'undefined') {
  // Never reached in a correct build. If it ever is, failing here is far
  // cheaper than a provider key reaching a browser bundle.
  throw new Error('lib/email/resend is server-only and must never be imported by a client.');
}

export interface MailerConfig {
  apiKey: string;
  from: string;
}

export class MailerNotConfiguredError extends Error {
  constructor(readonly missing: string[]) {
    super(`The email service is not configured: ${missing.join(', ')} not set.`);
    this.name = 'MailerNotConfiguredError';
  }
}

export class MailerUnavailableError extends Error {
  constructor(message = 'The email service could not be reached.') {
    super(message);
    this.name = 'MailerUnavailableError';
  }
}

export class MailerRejectedError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MailerRejectedError';
  }
}

/**
 * Reads the configuration, or says exactly what is missing.
 *
 * Deliberately NOT cached at module scope: a deployment that adds the key
 * should not need a restart to be believed, and a test can set and unset it.
 */
export function mailerConfig(): MailerConfig {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const missing: string[] = [];
  if (!apiKey) missing.push('RESEND_API_KEY');
  if (!from) missing.push('EMAIL_FROM');
  if (missing.length > 0) throw new MailerNotConfiguredError(missing);
  return { apiKey: apiKey as string, from: from as string };
}

export const mailerIsConfigured = (): boolean => {
  try {
    mailerConfig();
    return true;
  } catch {
    return false;
  }
};

/** Ten seconds, then 503 — a hung provider must not hang the route. */
const DEADLINE_MS = 10_000;

export interface SendOneResult {
  address: string;
  accepted: boolean;
  /** The provider's own message when it refused. Never the key, never a header. */
  error?: string;
}

/**
 * Sends one message to one address.
 *
 * ONE REQUEST PER RECIPIENT, on purpose. Resend's `to` accepts several
 * addresses, but they would then see each other — an administrator writing to
 * eleven supervisors would disclose the list to all of them. A per-recipient
 * send costs more requests and discloses nothing.
 */
export async function sendOneEmail(
  config: MailerConfig,
  address: string,
  subject: string,
  text: string,
): Promise<SendOneResult> {
  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: config.from, to: [address], subject, text }),
      signal: AbortSignal.timeout(DEADLINE_MS),
    });
  } catch {
    // A network failure or a deadline. The service could not answer at all,
    // which is different from it refusing — and different again from success.
    throw new MailerUnavailableError();
  }

  if (response.status === 429 || response.status >= 500) {
    // Rate limited or broken: the provider may accept this later, so it is an
    // availability problem rather than a refusal of this message.
    throw new MailerUnavailableError(`The email service answered ${response.status}.`);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    // The provider's sentence, never our request. The key travelled in a
    // header and is not echoed back, but nothing here logs the body either.
    return {
      address,
      accepted: false,
      error: body.message ?? `Refused (${response.status}).`,
    };
  }

  return { address, accepted: true };
}
