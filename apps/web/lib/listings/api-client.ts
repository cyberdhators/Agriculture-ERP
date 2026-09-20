import type {
  ListingCategory,
  ListingStatus,
  ListingUnit,
  ProduceListing,
  VerificationStatus,
} from '@/lib/fixtures/farmers';

export interface SellerInfo {
  id: string;
  verification_status: VerificationStatus;
  payam_id: string;
  payam_name: string;
  created_at: string;
}

export interface ApiListing {
  id: string;
  farmer_id: string;
  trading_name: string;
  title: string;
  category: string;
  product_name: string;
  description: string;
  quantity: number;
  unit: string;
  price_ssp: number;
  price_per: string;
  negotiable: boolean;
  delivery_available: boolean;
  available_from: string;
  available_until: string | null;
  harvest_season: string | null;
  pickup_notes: string | null;
  photo_storage_paths: string[];
  status: string;
  created_at: string;
  updated_at: string;
  seller_verification_status?: string;
  seller_payam_id?: string;
  seller_payam_name?: string;
  seller_created_at?: string;
}

export class ListingApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ListingApiError';
  }
}

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
}

interface PagedEnvelope<T> {
  data?: T[];
  cursor: string | null;
  hasMore: boolean;
  error?: { code: string; message: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok || body.data === undefined) {
    throw new ListingApiError(
      res.status,
      body.error?.code ?? 'request_failed',
      body.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return body.data;
}

async function requestPaged(
  path: string,
): Promise<{ data: ApiListing[]; hasMore: boolean; cursor: string | null }> {
  const res = await fetch(path);
  const body = (await res.json().catch(() => ({}))) as PagedEnvelope<ApiListing>;
  if (!res.ok || !body.data) {
    const err = body as unknown as { error?: { code: string; message: string } };
    throw new ListingApiError(
      res.status,
      err.error?.code ?? 'request_failed',
      err.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return { data: body.data, hasMore: body.hasMore, cursor: body.cursor };
}

export async function fetchListings(params?: {
  farmer_id?: string;
  category?: string;
  q?: string;
  limit?: number;
}): Promise<ApiListing[]> {
  const url = new URL('/api/listings', window.location.origin);
  if (params?.limit) url.searchParams.set('limit', String(params.limit));
  if (params?.farmer_id) url.searchParams.set('farmer_id', params.farmer_id);
  if (params?.category) url.searchParams.set('category', params.category);
  if (params?.q) url.searchParams.set('q', params.q);

  const all: ApiListing[] = [];
  let cursor: string | null = null;
  do {
    if (cursor) url.searchParams.set('cursor', cursor);
    const page = await requestPaged(url.toString());
    all.push(...page.data);
    cursor = page.hasMore ? page.cursor : null;
  } while (cursor);

  return all;
}

export async function fetchListing(id: string): Promise<ApiListing> {
  return request<ApiListing>(`/api/listings/${id}`);
}

export async function createListing(data: Record<string, unknown>): Promise<ApiListing> {
  return request<ApiListing>('/api/listings', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateListing(
  id: string,
  data: Record<string, unknown>,
): Promise<ApiListing> {
  return request<ApiListing>(`/api/listings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function toListing(api: ApiListing): ProduceListing {
  return {
    id: api.id,
    farmer_id: api.farmer_id,
    trading_name: api.trading_name,
    title: api.title,
    category: api.category as ListingCategory,
    product_name: api.product_name,
    description: api.description,
    quantity: api.quantity,
    unit: api.unit as ListingUnit,
    price_ssp: api.price_ssp,
    price_per: api.price_per as ListingUnit,
    negotiable: api.negotiable,
    delivery_available: api.delivery_available,
    available_from: api.available_from,
    available_until: api.available_until,
    harvest_season: api.harvest_season,
    pickup_notes: api.pickup_notes,
    contact_phone: '',
    photo_storage_paths: api.photo_storage_paths ?? [],
    status: api.status as ListingStatus,
    created_at: api.created_at,
    updated_at: api.updated_at,
  };
}

export function toSeller(api: ApiListing): SellerInfo {
  return {
    id: api.farmer_id,
    verification_status: (api.seller_verification_status ?? 'pending') as VerificationStatus,
    payam_id: api.seller_payam_id ?? '',
    payam_name: api.seller_payam_name ?? '',
    created_at: api.seller_created_at ?? api.created_at,
  };
}
