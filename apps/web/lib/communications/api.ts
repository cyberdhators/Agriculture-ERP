import {
  sendCommunicationSchema,
  type CommunicationResult,
  type SendCommunication,
} from '@agri-erp/shared';

/**
 * THE COMMUNICATIONS CLIENT — WRITTEN AGAINST A ROUTE THAT DOES NOT EXIST YET.
 *
 * `POST /api/admin/communications` EXISTS as of 2026-09-17 and sends through
 * Resend. What may still be absent is the CONFIGURATION: with no
 * `RESEND_API_KEY` or `EMAIL_FROM` the route answers 503
 * `email_not_configured` and sends nothing. `GET` — sent history — is still
 * unimplemented, because no communications table exists.
 *
 * HOW "NOT CONNECTED" IS DETECTED, AND WHY IT IS NOT A FLAG. A request to a
 * route Next does not serve answers 404. That is turned into
 * `ServiceNotConnectedError`, which the screen renders as an explicit
 * unavailable state. No environment flag has to be remembered, nothing has to
 * be flipped, and a screen becomes live by itself the moment its route is
 * deployed — which is the opposite of a mock, because there is no code path
 * here that can report a success that did not happen.
 */

export class ServiceNotConnectedError extends Error {
  constructor(readonly service: string) {
    super(`${service} is not connected on this deployment.`);
    this.name = 'ServiceNotConnectedError';
  }
}

export class CommunicationApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommunicationApiError';
  }
}

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
}

/**
 * Sends the request and refuses to invent an outcome.
 *
 * A 404 means the route is not deployed. Anything else is reported as what it
 * was — never as a success, and never as a reason to redirect to sign-in,
 * which is the middleware's business and not an unreachable provider's.
 */
async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });

  if (response.status === 404) throw new ServiceNotConnectedError('The messaging service');

  const body = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok) {
    throw new CommunicationApiError(
      response.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? `The message could not be sent (${response.status}).`,
    );
  }
  if (!body.data) throw new CommunicationApiError(500, 'empty', 'No result in the response.');
  return body.data;
}

/**
 * Send one message. `POST /api/admin/communications`, administrator only.
 *
 * The body carries RECORD IDS, never addresses or phone numbers: the server
 * resolves each recipient itself, so a browser never holds a list of people's
 * contact details and an address cannot be substituted in flight.
 *
 * The body is validated here by the same shared schema the route will use, so
 * the composer and the server cannot disagree about what is valid.
 */
export async function sendCommunication(input: SendCommunication): Promise<CommunicationResult> {
  const parsed = sendCommunicationSchema.parse(input);
  return request<CommunicationResult>('/api/admin/communications', {
    method: 'POST',
    body: JSON.stringify(parsed),
  });
}

/**
 * Sent history. THE ROUTE DOES NOT EXIST: there is no communications table, and
 * assembling a history out of audit rows would be a different thing wearing the
 * same name. No screen calls this, and no history is fabricated — the address
 * answers 405, because the route file defines POST and nothing else.
 */
export async function listCommunications(): Promise<CommunicationResult[]> {
  return request<CommunicationResult[]>('/api/admin/communications', { method: 'GET' });
}
