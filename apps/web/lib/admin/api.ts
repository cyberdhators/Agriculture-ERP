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
  /**
   * `orphan_auth_accounts` rides on the users page beside cursor and hasMore.
   * The route computes it for an ADMINISTRATOR on the FIRST page only — it is a
   * scan of every authentication account, and a supervisor has no business
   * knowing about accounts outside their state — so it is absent the rest of
   * the time and must never be rendered as a zero.
   */
  page?: { cursor: string | null; hasMore: boolean; orphan_auth_accounts?: number };
  error?: { code: string; message: string; rule?: string };
}

/** One page of a cursor-paginated list, as CONVENTIONS §6.1 shapes it. */
export interface Page<T> {
  rows: T[];
  cursor: string | null;
  hasMore: boolean;
}

export interface PageParams {
  cursor?: string;
  limit?: number;
}

const pageQuery = (params: PageParams): string => {
  const qs = new URLSearchParams();
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  const query = qs.toString();
  return query ? `?${query}` : '';
};

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

/**
 * One page of staff accounts.
 *
 * It used to take no parameters, fetch the first page and throw the cursor
 * away — which made a national list look complete when it was one page of it.
 * The route pages by cursor and reports no total, so the caller gets the page,
 * the cursor for the next one, and the administrator-only orphan diagnostic
 * when the route chose to send it.
 */
export interface StaffPage extends Page<StaffUser> {
  /** Present only when the route sent it: administrator, first page. */
  orphanAuthAccounts?: number;
}

export async function listStaff(params: PageParams = {}): Promise<StaffPage> {
  const body = await request<StaffUser[]>(`/api/users${pageQuery(params)}`);
  return {
    rows: body.data ?? [],
    cursor: body.page?.cursor ?? null,
    hasMore: body.page?.hasMore ?? false,
    ...(body.page?.orphan_auth_accounts === undefined
      ? {}
      : { orphanAuthAccounts: body.page.orphan_auth_accounts }),
  };
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

/** One page of extension officers, by cursor. Same correction as listStaff. */
export async function listOfficers(params: PageParams = {}): Promise<Page<Officer>> {
  const body = await request<Officer[]>(`/api/officers${pageQuery(params)}`);
  return {
    rows: body.data ?? [],
    cursor: body.page?.cursor ?? null,
    hasMore: body.page?.hasMore ?? false,
  };
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

/**
 * DEACTIVATION, AND THE NUMBER IT RETURNS.
 *
 * C-8R.3, added by the owner: the act that leaves farmers without a working
 * officer says how many. The route answers the deactivation with
 * `unassigned_farmers` beside the officer record — only on a PATCH that
 * actually moves the status to `inactive`, never on reactivation and never on
 * the soft delete, which answers 204 with no body at all.
 *
 * This is a COUNT RETURNED BY THE SERVER, not something a client can work out:
 * there is no route that reports an officer's caseload, and counting from a
 * paginated farmer list would be wrong. When it is absent it is absent — the
 * caller must not print zero.
 */
export interface OfficerStatusResult {
  officer: Officer;
  /** Present only on a deactivation the server performed. Never fabricated. */
  unassignedFarmers?: number;
}

export async function setOfficerActive(id: string, active: boolean): Promise<OfficerStatusResult> {
  const body = await request<Officer & { unassigned_farmers?: number }>(
    `/api/officers/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ status: active ? 'active' : 'inactive' }) },
  );
  if (!body.data) throw new AdminApiError(500, 'empty', 'No officer in the response');
  const { unassigned_farmers, ...officer } = body.data;
  return {
    officer: officer as Officer,
    ...(unassigned_farmers === undefined ? {} : { unassignedFarmers: unassigned_farmers }),
  };
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
  // The audit route's schema (auditFilterSchema) names these `from`/`to`.
  from?: string;
  to?: string;
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
