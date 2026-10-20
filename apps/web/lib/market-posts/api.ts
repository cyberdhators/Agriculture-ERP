/**
 * LISTINGS LANE (2026-10-19) -- the browser's calls for buying requests,
 * service listings, a produce sale, and reports on the new kinds of post.
 * Every call goes through an API route; the routes decide who may do what.
 */

export class MarketPostError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'MarketPostError';
  }
}

interface Envelope<T> {
  data?: T;
  page?: { cursor: string | null; hasMore: boolean };
  error?: { code: string; message: string; fields?: Record<string, string> };
}

async function call<T>(path: string, init: RequestInit = {}): Promise<Envelope<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
    });
  } catch {
    throw new MarketPostError(
      0,
      'network',
      'The server could not be reached. Check the connection.',
    );
  }
  const body = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok) {
    throw new MarketPostError(
      res.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? `The request failed (${res.status}).`,
      body.error?.fields ?? {},
    );
  }
  return body;
}

const one = async <T>(path: string, init?: RequestInit) => (await call<T>(path, init)).data as T;
const send = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

/** Every page of a public list, up to `max` rows. */
async function all<T>(path: string, params: Record<string, string>, max = 200): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ ...params, limit: '50' });
    if (cursor) q.set('cursor', cursor);
    const page: Envelope<T[]> = await call<T[]>(`${path}?${q.toString()}`);
    out.push(...(page.data ?? []));
    cursor = page.page?.hasMore ? page.page.cursor : null;
  } while (cursor && out.length < max);
  return out;
}

const clean = (params: Record<string, string | undefined>) =>
  Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== ''),
  ) as Record<string, string>;

// ---------------------------------------------------------------------------
// BUYING REQUESTS
// ---------------------------------------------------------------------------

export interface BuyingRequest {
  id: string;
  poster_type: 'farmer' | 'buyer';
  display_name: string;
  poster_verified: boolean;
  category: string;
  product_name: string;
  quantity: number;
  unit: string;
  state_id: string;
  state_name: string;
  location: string;
  needed_by: string;
  price_ssp: number | null;
  price_per: string | null;
  negotiable: boolean;
  delivery_terms: string | null;
  description: string | null;
  /** 2026-10-20: whether the poster offers their phone (never the number). */
  phone_shared: boolean;
  /** 2026-10-23: false when the poster turned in-app messaging off. */
  messages_allowed?: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  /** The owner's own copy only. */
  contact_phone?: string;
  show_phone?: boolean;
}

export const listBuyingRequests = (filter: {
  q?: string;
  category?: string;
  state_id?: string;
  poster?: string;
}) => all<BuyingRequest>('/api/buying-requests', clean(filter));
export const getBuyingRequest = (id: string) =>
  one<BuyingRequest>(`/api/buying-requests/${encodeURIComponent(id)}`);
export const myBuyingRequests = () => one<BuyingRequest[]>('/api/buying-requests/mine');
export const createBuyingRequest = (body: Record<string, unknown>) =>
  one<BuyingRequest>('/api/buying-requests', send('POST', body));
export const updateBuyingRequest = (id: string, body: Record<string, unknown>) =>
  one<BuyingRequest>(`/api/buying-requests/${encodeURIComponent(id)}`, send('PATCH', body));

// ---------------------------------------------------------------------------
// SERVICE LISTINGS
// ---------------------------------------------------------------------------

export interface ServiceListing {
  id: string;
  trading_name: string;
  farmer_verified: boolean;
  service_type: string;
  title: string;
  description: string;
  location: string;
  payam_name: string;
  state_id: string;
  state_name: string;
  available_from: string;
  available_until: string | null;
  availability_note: string | null;
  price_ssp: number | null;
  price_unit: string | null;
  negotiable: boolean;
  phone_shared: boolean;
  /** 2026-10-23: false when the poster turned in-app messaging off. */
  messages_allowed?: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  contact_phone?: string;
  show_phone?: boolean;
}

export const listServices = (filter: { q?: string; service_type?: string; state_id?: string }) =>
  all<ServiceListing>('/api/services', clean(filter));
export const getService = (id: string) =>
  one<ServiceListing>(`/api/services/${encodeURIComponent(id)}`);
export const myServices = () => one<ServiceListing[]>('/api/services/mine');
export const createService = (body: Record<string, unknown>) =>
  one<ServiceListing>('/api/services', send('POST', body));
export const updateService = (id: string, body: Record<string, unknown>) =>
  one<ServiceListing>(`/api/services/${encodeURIComponent(id)}`, send('PATCH', body));

// ---------------------------------------------------------------------------
// CONTACT, REPORTS, SALES
// ---------------------------------------------------------------------------

export type PostKind = 'buying-requests' | 'services';

/** 2026-10-23: what a report can be about -- a post, or a published public profile. */
export type ReportTarget = PostKind | 'profiles/p';

/** The poster's phone, for a signed-in farmer or buyer. 401/403 means sign in first. */
export const getContact = (kind: PostKind, id: string) =>
  one<{ display_name: string; contact_phone: string | null }>(
    `/api/${kind}/${encodeURIComponent(id)}/contact`,
  );

export const reportPost = (
  kind: ReportTarget,
  id: string,
  body: { reason: string; description?: string },
) => one<{ received: true }>(`/api/${kind}/${encodeURIComponent(id)}/reports`, send('POST', body));

/** A produce sale. Needs signal: it is never queued, because a retry would count it twice. */
export const recordSale = (listingId: string, body: { quantity: number; close: boolean }) =>
  one<Record<string, unknown>>(
    `/api/farmer/listings/${encodeURIComponent(listingId)}/sales`,
    send('POST', body),
  );

/** The states a request can be for (signed-in accounts). */
export const listStates = async () =>
  (await one<{ states: { id: string; name: string }[] }>('/api/locations')).states;

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`;
