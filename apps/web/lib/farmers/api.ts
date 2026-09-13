// Client data layer for the farmer register. It calls the B5 routes
// (`/api/farmers`) through the standard response envelope (CONVENTIONS §3) and
// maps the API's `present()` shape onto the `Farmer` view type the screens
// already render, so switching a screen from fixtures to live data is a source
// swap, not a rewrite. Authorization, scope and validation all live on the
// server; this module never talks to the database.

import type { CreateFarmer, PatchFarmer } from '@agri-erp/shared';

import type { Farmer } from '@/lib/fixtures/farmers';

/** Flip to live data with `NEXT_PUBLIC_USE_LIVE_FARMERS=1`. Off = fixtures. */
export const LIVE_FARMERS = process.env.NEXT_PUBLIC_USE_LIVE_FARMERS === '1';

/** An error carried by an API error body (CONVENTIONS §4), with its status. */
export class FarmerApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly rule?: string,
  ) {
    super(message);
    this.name = 'FarmerApiError';
  }
}

/** The subset of `present()` this client reads. Extra keys are ignored. */
interface FarmerRowDto {
  id: string;
  farmer_number: string;
  given_name: string;
  family_name: string;
  sex: Farmer['sex'];
  year_of_birth: number;
  phone: string;
  national_id?: string | null;
  payam_id: string;
  state_id: string;
  registered_by: string | null;
  caseload_officer_id: string | null;
  registration_source: Farmer['registration_source'];
  verification_status: Farmer['verification_status'];
  merged_into: string | null;
  consent: { id: string };
  created_at: string;
}

/** Map one API row onto the view type. The only shape differences from
 *  `present()` are `consent.id` → `consent_id` and an absent `national_id`
 *  (hidden from supervisor/read_only) becoming `null`. */
export function toFarmer(row: FarmerRowDto): Farmer {
  return {
    id: row.id,
    farmer_number: row.farmer_number,
    given_name: row.given_name,
    family_name: row.family_name,
    sex: row.sex,
    year_of_birth: row.year_of_birth,
    phone: row.phone,
    national_id: row.national_id ?? null,
    payam_id: row.payam_id,
    state_id: row.state_id,
    registered_by: row.registered_by,
    // C-8R: the caseload officer beside the registering officer. Show the first as
    // "officer" and the second as history.
    caseload_officer_id: row.caseload_officer_id,
    registration_source: row.registration_source,
    verification_status: row.verification_status,
    merged_into: row.merged_into,
    consent_id: row.consent.id,
    created_at: row.created_at,
  };
}

interface Envelope<T> {
  data?: T;
  page?: { cursor: string | null; hasMore: boolean };
  warnings?: { duplicates?: string[] };
  error?: { code: string; message: string; rule?: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok) {
    const err = body.error;
    throw new FarmerApiError(
      res.status,
      err?.code ?? 'unknown',
      err?.message ?? `Request failed (${res.status})`,
      err?.rule,
    );
  }
  return body;
}

/** Query filters accepted by `GET /api/farmers` (C-5.7). */
export interface FarmerListParams {
  verification_status?: Farmer['verification_status'];
  payam?: string;
  county?: string;
  sex?: Farmer['sex'];
  registered_from?: string;
  registered_to?: string;
  duplicate_flag?: 'true' | 'false';
  limit?: number;
  cursor?: string;
}

export interface FarmerListResult {
  farmers: Farmer[];
  cursor: string | null;
  hasMore: boolean;
}

export async function listFarmers(params: FarmerListParams = {}): Promise<FarmerListResult> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, String(value));
  }
  const query = qs.toString();
  const body = await request<FarmerRowDto[]>(`/api/farmers${query ? `?${query}` : ''}`);
  return {
    farmers: (body.data ?? []).map(toFarmer),
    cursor: body.page?.cursor ?? null,
    hasMore: body.page?.hasMore ?? false,
  };
}

export async function getFarmer(id: string): Promise<Farmer> {
  const body = await request<FarmerRowDto>(`/api/farmers/${encodeURIComponent(id)}`);
  if (!body.data) throw new FarmerApiError(500, 'empty', 'No farmer in the response');
  return toFarmer(body.data);
}

export interface FarmerWriteResult {
  farmer: Farmer;
  duplicates: string[];
}

export async function createFarmer(input: CreateFarmer): Promise<FarmerWriteResult> {
  const body = await request<FarmerRowDto>('/api/farmers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!body.data) throw new FarmerApiError(500, 'empty', 'No farmer in the response');
  return { farmer: toFarmer(body.data), duplicates: body.warnings?.duplicates ?? [] };
}

export async function patchFarmer(id: string, input: PatchFarmer): Promise<FarmerWriteResult> {
  const body = await request<FarmerRowDto>(`/api/farmers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!body.data) throw new FarmerApiError(500, 'empty', 'No farmer in the response');
  return { farmer: toFarmer(body.data), duplicates: body.warnings?.duplicates ?? [] };
}
