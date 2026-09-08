// Client data layer for the verification review queue (deliverable c, C-6). It
// calls the live B6 routes — GET /api/verification/queue and the decision routes
// under /api/farmers/:id/… — through the standard response envelope
// (CONVENTIONS §3). Authorization, scope and the state machine live on the
// server. Gated by NEXT_PUBLIC_USE_LIVE_VERIFICATION (off = fixtures).

import type { RejectionReason } from '@agri-erp/shared';

import type { Farmer } from '@/lib/fixtures/farmers';

export const LIVE_VERIFICATION = process.env.NEXT_PUBLIC_USE_LIVE_VERIFICATION === '1';

export class VerificationApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly rule?: string,
  ) {
    super(message);
    this.name = 'VerificationApiError';
  }
}

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
  caseload_officer_id?: string | null;
  registration_source: Farmer['registration_source'];
  verification_status: Farmer['verification_status'];
  merged_into: string | null;
  consent?: { id: string };
  created_at: string;
}

interface QueueRowDto extends FarmerRowDto {
  days_waiting: number;
  escalated: boolean;
  duplicates?: FarmerRowDto[];
}

function toFarmer(row: FarmerRowDto): Farmer {
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
    caseload_officer_id: row.caseload_officer_id ?? null,
    registration_source: row.registration_source,
    verification_status: row.verification_status,
    merged_into: row.merged_into,
    consent_id: row.consent?.id ?? '',
    created_at: row.created_at,
  };
}

/** A pending farmer plus the review metadata the queue adds (C-6). */
export interface QueueItem extends Farmer {
  days_waiting: number;
  escalated: boolean;
  duplicates: Farmer[];
}

interface Envelope<T> {
  data?: T;
  page?: { cursor: string | null; hasMore: boolean };
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
    throw new VerificationApiError(
      res.status,
      err?.code ?? 'unknown',
      err?.message ?? `Request failed (${res.status})`,
      err?.rule,
    );
  }
  return body;
}

export interface QueueFilter {
  escalated?: 'true' | 'false';
  payam?: string;
  county?: string;
}

export async function listQueue(filter: QueueFilter = {}): Promise<QueueItem[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) if (v) qs.set(k, String(v));
  const query = qs.toString();
  const body = await request<QueueRowDto[]>(`/api/verification/queue${query ? `?${query}` : ''}`);
  return (body.data ?? []).map((row) => ({
    ...toFarmer(row),
    days_waiting: row.days_waiting,
    escalated: row.escalated,
    duplicates: (row.duplicates ?? []).map(toFarmer),
  }));
}

async function decide(id: string, action: string, payload?: unknown): Promise<Farmer> {
  const body = await request<FarmerRowDto>(`/api/farmers/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  });
  if (!body.data) throw new VerificationApiError(500, 'empty', 'No farmer in the response');
  return toFarmer(body.data);
}

export const verifyFarmer = (id: string): Promise<Farmer> => decide(id, 'verify');

export const resubmitFarmer = (id: string): Promise<Farmer> => decide(id, 'resubmit');

export const rejectFarmer = (
  id: string,
  input: { reason_code?: RejectionReason; note?: string },
): Promise<Farmer> => decide(id, 'reject', input);

export const mergeFarmer = (
  id: string,
  input: { target_id: string; note?: string },
): Promise<Farmer> => decide(id, 'merge', input);
