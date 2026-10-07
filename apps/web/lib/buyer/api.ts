import type {
  BuyerProfilePatch,
  CartCheckout,
  BuyerRegistration,
  BuyerVerificationStatus,
  CreateOrder,
  OrderStatusChange,
  PurchaseRequestInput,
  PurchaseRequestPatch,
} from '@agri-erp/shared';

/**
 * THE BUYER CLIENT (B13). Every screen on the buyer side, and the two
 * administrator screens that serve it, read and write through here.
 *
 * Nothing in this file decides what a buyer may see: the routes do, and the
 * shapes below are what they return. A failure is reported as what it was --
 * status, code, the server's own sentence and its field reasons -- never as a
 * success and never as an empty list.
 */

export class BuyerApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'BuyerApiError';
  }
}

interface Envelope<T> {
  data?: T;
  page?: { cursor: string | null; hasMore: boolean; unread?: number };
  error?: { code: string; message: string; fields?: Record<string, string> };
}

export interface Page<T> {
  rows: T[];
  cursor: string | null;
  hasMore: boolean;
  unread?: number;
}

async function send<T>(path: string, init: RequestInit = {}): Promise<Envelope<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
    });
  } catch {
    throw new BuyerApiError(0, 'network', 'The server could not be reached. Check the connection.');
  }
  const body = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok) {
    throw new BuyerApiError(
      response.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? `The request failed (${response.status}).`,
      body.error?.fields ?? {},
    );
  }
  return body;
}

async function one<T>(path: string, init?: RequestInit): Promise<T> {
  const body = await send<T>(path, init);
  if (body.data === undefined) throw new BuyerApiError(500, 'empty', 'No result in the response.');
  return body.data;
}

async function page<T>(path: string): Promise<Page<T>> {
  const body = await send<T[]>(path);
  return {
    rows: body.data ?? [],
    cursor: body.page?.cursor ?? null,
    hasMore: body.page?.hasMore ?? false,
    ...(body.page?.unread !== undefined ? { unread: body.page.unread } : {}),
  };
}

const query = (params: Record<string, string | undefined | null>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

// ---------------------------------------------------------------------------
// SHAPES, as the routes return them
// ---------------------------------------------------------------------------

export interface BuyerProfile {
  person: {
    id: string;
    given_name: string;
    family_name: string;
    email: string | null;
    phone: string;
  };
  organization: {
    id: string;
    account_type: 'individual' | 'business';
    name: string;
    organization_type: string;
    registration_number: string | null;
    tax_id: string | null;
    country_code: string;
    state_id: string | null;
    county_id: string | null;
    city: string | null;
    address: string | null;
    website: string | null;
    description: string | null;
    created_at: string;
  };
  procurement: {
    interested_categories: string[];
    interested_products: string[];
    preferred_state_ids: string[];
    min_quantity: number | null;
    max_quantity: number | null;
    preferred_unit: string | null;
    delivery_locations: string[];
    purchasing_months: number[];
    payment_preferences: string[];
  };
  verification: {
    status: BuyerVerificationStatus;
    note: string | null;
    verified_at: string | null;
    capabilities: { browse: boolean; request: boolean };
  };
}

export interface MarketListing {
  id: string;
  title: string;
  product_name: string;
  category: string;
  description: string;
  available_quantity: number;
  unit: string;
  indicative_price_ssp: number;
  price_per: string;
  negotiable: boolean;
  delivery_available: boolean;
  available_from: string;
  available_until: string | null;
  production_period: string | null;
  quality_grade: string | null;
  min_order_quantity: number | null;
  supplier: { trading_name: string; verified: boolean };
  location: { payam: string; county_id: string; county: string; state_id: string; state: string };
  updated_at: string;
  /** B14: the farmer's phone, given only once this buyer has sent a request for it. */
  farmer_phone?: string | null;
}

export interface PurchaseRequest {
  id: string;
  listing_id: string | null;
  listing_title: string | null;
  category: string;
  product_name: string;
  quantity: number;
  unit: string;
  delivery_location: string;
  required_by: string | null;
  notes: string | null;
  status: string;
  submitted_at: string | null;
  decision_note: string | null;
  decided_at: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  organization?: { id: string; name: string };
  /** B14: the farmer's phone, once the request has been sent. */
  farmer_phone?: string | null;
}

export interface TimelineEntry {
  id: string;
  status: string;
  note: string | null;
  recorded_by: 'buyer' | 'corwado';
  occurred_at: string;
}

export interface Order {
  id: string;
  order_number: string;
  purchase_request_id: string | null;
  listing_id: string;
  category: string;
  product_name: string;
  quantity: number;
  unit: string;
  unit_price_ssp: number;
  total_ssp: number;
  status: string;
  delivery_location: string;
  expected_delivery_date: string | null;
  cancel_reason: string | null;
  supplier: { trading_name: string; county: string; state: string };
  order_date: string;
  updated_at: string;
  timeline?: TimelineEntry[];
  latest_note?: string | null;
  organization?: { id: string; name: string };
}

export interface BuyerNotification {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface BuyerSummary {
  verification: BuyerVerificationStatus;
  kpis: {
    active_purchase_requests: number;
    draft_purchase_requests: number;
    available_products: number | null;
    pending_orders: number;
    orders_in_progress: number;
    completed_purchases: number;
    total_quantity_purchased: { unit: string; quantity: number }[];
  };
  procurement: {
    orders_by_status: { status: string; n: number }[];
    purchases_by_month: { month: string; orders: number; total_ssp: number }[];
    categories_purchased: { category: string; orders: number; total_ssp: number }[];
  };
  supply: {
    by_category: { category: string; listings: number }[];
    by_state: { state_id: string; state: string; listings: number }[];
  } | null;
}

export interface AdminBuyerOrganization {
  id: string;
  account_type: 'individual' | 'business';
  name: string;
  organization_type: string;
  registration_number: string | null;
  tax_id: string | null;
  country_code: string;
  state_id: string | null;
  city: string | null;
  website: string | null;
  description: string | null;
  verification_status: BuyerVerificationStatus;
  verification_note: string | null;
  verified_at: string | null;
  created_at: string;
  contact: { name: string | null; phone: string | null; email: string | null };
  open_requests: number;
}

export interface Locations {
  states: { id: string; name: string }[];
  counties: { id: string; name: string; state_id: string }[];
}

// ---------------------------------------------------------------------------
// THE BUYER'S CALLS
// ---------------------------------------------------------------------------

export const registerBuyer = (body: BuyerRegistration) =>
  one<{ id: string; organization_id: string; account_type: string; verification_status: string }>(
    '/api/buyer/register',
    json('POST', body),
  );

export const getProfile = () => one<BuyerProfile>('/api/buyer/profile');
export const updateProfile = (patch: BuyerProfilePatch) =>
  one<BuyerProfile>('/api/buyer/profile', json('PATCH', patch));

export const getSummary = () => one<BuyerSummary>('/api/buyer/summary');

export interface MarketQuery {
  q?: string;
  category?: string;
  state_id?: string;
  county_id?: string;
  min_quantity?: string;
  available_by?: string;
  grade?: string;
  min_price?: string;
  max_price?: string;
  supplier?: string;
  cursor?: string | null;
  limit?: string;
}

export const listMarket = (q: MarketQuery) =>
  page<MarketListing>(`/api/buyer/marketplace${query({ ...q })}`);
export const getListing = (id: string) =>
  one<MarketListing>(`/api/buyer/marketplace/${encodeURIComponent(id)}`);

export const listRequests = (status?: string, cursor?: string | null) =>
  page<PurchaseRequest>(`/api/buyer/purchase-requests${query({ status, cursor })}`);
export const createRequest = (body: PurchaseRequestInput) =>
  one<PurchaseRequest>('/api/buyer/purchase-requests', json('POST', body));
/** B14: send the cart -- one request per product, each to its own farmer. */
export const checkoutCart = (body: CartCheckout) =>
  one<PurchaseRequest[]>('/api/buyer/cart', json('POST', body));
export const getRequest = (id: string) =>
  one<PurchaseRequest>(`/api/buyer/purchase-requests/${encodeURIComponent(id)}`);
export const patchRequest = (id: string, body: PurchaseRequestPatch) =>
  one<PurchaseRequest>(
    `/api/buyer/purchase-requests/${encodeURIComponent(id)}`,
    json('PATCH', body),
  );

export const listOrders = (status?: string, cursor?: string | null) =>
  page<Order>(`/api/buyer/orders${query({ status, cursor })}`);
export const getOrder = (id: string) => one<Order>(`/api/buyer/orders/${encodeURIComponent(id)}`);
export const cancelOrder = (id: string, reason: string) =>
  one<Order>(`/api/buyer/orders/${encodeURIComponent(id)}`, json('PATCH', { reason }));

export const listDeliveries = (cursor?: string | null) =>
  page<Order>(`/api/buyer/deliveries${query({ cursor })}`);

export const listNotifications = (unreadOnly = false, cursor?: string | null) =>
  page<BuyerNotification>(
    `/api/buyer/notifications${query({ unread: unreadOnly ? '1' : undefined, cursor })}`,
  );
export const markNotificationRead = (id: string) =>
  one<{ id: string; read_at: string | null }>(
    `/api/buyer/notifications/${encodeURIComponent(id)}`,
    json('PATCH', {}),
  );

export const getLocations = () => one<Locations>('/api/locations');

// ---------------------------------------------------------------------------
// THE ADMINISTRATOR'S CALLS
// ---------------------------------------------------------------------------

export const adminListBuyers = (status?: string, cursor?: string | null) =>
  page<AdminBuyerOrganization>(`/api/admin/buyers${query({ status, cursor })}`);
export const adminDecideBuyer = (id: string, status: string, note?: string) =>
  one<{ id: string; verification_status: string }>(
    `/api/admin/buyers/${encodeURIComponent(id)}`,
    json('PATCH', { status, ...(note ? { note } : {}) }),
  );

export const adminListRequests = (status?: string, cursor?: string | null) =>
  page<PurchaseRequest>(`/api/admin/purchase-requests${query({ status, cursor })}`);

export const adminListOrders = (status?: string, cursor?: string | null) =>
  page<Order>(`/api/admin/orders${query({ status, cursor })}`);
export const adminCreateOrder = (body: CreateOrder) =>
  one<Order>('/api/admin/orders', json('POST', body));
export const adminMoveOrder = (id: string, change: OrderStatusChange) =>
  one<Order>(`/api/admin/orders/${encodeURIComponent(id)}`, json('PATCH', change));
