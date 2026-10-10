import {
  sendCommunicationSchema,
  type CommunicationFarmer,
  type CommunicationFarmerIds,
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

/** The SMS farmer picker's filters. Every one optional; empty strings are dropped. */
export interface FarmerPickerFilter {
  q?: string;
  state?: string;
  county?: string;
  payam?: string;
  verification_status?: string;
}

export interface FarmerPickerPage {
  rows: CommunicationFarmer[];
  cursor: string | null;
  hasMore: boolean;
  /** Every farmer matching the filter, across all pages. */
  total: number;
  /** How many of those an SMS can actually reach. */
  reachable: number;
}

const pickerQuery = (filter: FarmerPickerFilter, extra: Record<string, string>): string => {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filter, ...extra })) {
    if (typeof value === 'string' && value.trim() !== '') qs.set(key, value.trim());
  }
  return qs.toString();
};

/**
 * One page of farmers for the SMS picker. `GET /api/admin/communications/farmers`.
 * The rows carry ids, names and places — never a phone number.
 */
export async function listPickerFarmers(
  filter: FarmerPickerFilter,
  page: { cursor?: string | null; limit?: number } = {},
): Promise<FarmerPickerPage> {
  const query = pickerQuery(filter, {
    ...(page.cursor ? { cursor: page.cursor } : {}),
    ...(page.limit ? { limit: String(page.limit) } : {}),
  });
  const response = await fetch(`/api/admin/communications/farmers?${query}`, {
    headers: { accept: 'application/json' },
  });
  if (response.status === 404) throw new ServiceNotConnectedError('The farmer list for SMS');
  const body = (await response.json().catch(() => ({}))) as {
    data?: CommunicationFarmer[];
    page?: { cursor: string | null; hasMore: boolean; total?: number; reachable?: number };
    error?: { code: string; message: string };
  };
  if (!response.ok || !body.data) {
    throw new CommunicationApiError(
      response.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? 'Could not load the farmers.',
    );
  }
  return {
    rows: body.data,
    cursor: body.page?.cursor ?? null,
    hasMore: body.page?.hasMore ?? false,
    total: body.page?.total ?? body.data.length,
    reachable: body.page?.reachable ?? body.data.filter((r) => r.reachable).length,
  };
}

/** Every reachable farmer id matching the filter, up to one message's cap. */
export async function selectAllPickerFarmers(
  filter: FarmerPickerFilter,
): Promise<CommunicationFarmerIds> {
  return request<CommunicationFarmerIds>(
    `/api/admin/communications/farmers?${pickerQuery(filter, { select: 'ids' })}`,
    { method: 'GET' },
  );
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
