// Client data layer for user administration (deliverable (r), C-3). It calls the
// live B3 routes — /api/users (staff accounts) and /api/officers (extension
// officers) — through the standard response envelope (CONVENTIONS §3). All
// authorization, scope and validation live on the server; this module never
// touches the database. Gated by NEXT_PUBLIC_USE_LIVE_ADMIN (off = fixtures).

import type {
  CreateOfficer,
  CreateUser,
  PatchOfficer,
  PatchUser,
  UserRole,
} from '@agri-erp/shared';

export const LIVE_ADMIN = process.env.NEXT_PUBLIC_USE_LIVE_ADMIN === '1';

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly rule?: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

/** A staff account, as `/api/users` presents it. */
export interface StaffUser {
  id: string;
  name: string;
  role: UserRole;
  state_id: string | null;
  last_login_at: string | null;
  created_at: string;
}

/** An extension officer, as `/api/officers` presents it. */
export interface Officer {
  id: string;
  name: string;
  phone: string;
  payam_id: string;
  state_id: string;
  status: 'active' | 'inactive';
  last_sync_at: string | null;
  created_at: string;
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
    throw new AdminApiError(
      res.status,
      err?.code ?? 'unknown',
      err?.message ?? `Request failed (${res.status})`,
      err?.rule,
    );
  }
  return body;
}

// ── Staff accounts ─────────────────────────────────────────────────────────

export async function listStaff(): Promise<StaffUser[]> {
  const body = await request<StaffUser[]>('/api/users');
  return body.data ?? [];
}

export async function createStaff(input: CreateUser): Promise<StaffUser> {
  const body = await request<StaffUser>('/api/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!body.data) throw new AdminApiError(500, 'empty', 'No account in the response');
  return body.data;
}

export async function patchStaff(id: string, input: PatchUser): Promise<StaffUser> {
  const body = await request<StaffUser>(`/api/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!body.data) throw new AdminApiError(500, 'empty', 'No account in the response');
  return body.data;
}

/** Soft delete — deactivation ends access immediately (C-3.6). */
export async function deactivateStaff(id: string): Promise<void> {
  await request<unknown>(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Extension officers ─────────────────────────────────────────────────────

export async function listOfficers(): Promise<Officer[]> {
  const body = await request<Officer[]>('/api/officers');
  return body.data ?? [];
}

export async function createOfficer(input: CreateOfficer): Promise<Officer> {
  const body = await request<Officer>('/api/officers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!body.data) throw new AdminApiError(500, 'empty', 'No officer in the response');
  return body.data;
}

export async function patchOfficer(id: string, input: PatchOfficer): Promise<Officer> {
  const body = await request<Officer>(`/api/officers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!body.data) throw new AdminApiError(500, 'empty', 'No officer in the response');
  return body.data;
}

/** C-3.6: an officer is deactivated by status, and it ends access at once. */
export function setOfficerActive(id: string, active: boolean): Promise<Officer> {
  return patchOfficer(id, { status: active ? 'active' : 'inactive' });
}

// ── Audit trail (deliverable (s), C-4) ──────────────────────────────────────

/** One row of the append-only audit log, as `/api/audit` presents it. */
export interface AuditEvent {
  id: string;
  entity_type: string;
  entity_id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  before: unknown;
  after: unknown;
  device_id: string | null;
  occurred_at: string;
}

export interface AuditFilterParams {
  entity_type?: string;
  entity_id?: string;
  actor_id?: string;
  occurred_from?: string;
  occurred_to?: string;
  limit?: number;
  cursor?: string;
}

export interface AuditResult {
  events: AuditEvent[];
  cursor: string | null;
  hasMore: boolean;
}

export async function listAudit(params: AuditFilterParams = {}): Promise<AuditResult> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, String(value));
  }
  const query = qs.toString();
  const body = await request<AuditEvent[]>(`/api/audit${query ? `?${query}` : ''}`);
  return {
    events: body.data ?? [],
    cursor: body.page?.cursor ?? null,
    hasMore: body.page?.hasMore ?? false,
  };
}
