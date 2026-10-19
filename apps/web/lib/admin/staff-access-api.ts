// Client data layer for staff permissions, Super Admin delegation and access
// logs (2026-10-19). It calls the live routes under /api/admin/staff-access and
// /api/admin/access-logs. Every decision is the server's: these functions only
// carry requests and report refusals in the API's own words.

import type {
  AccessEvent,
  GrantPresetInput,
  PermissionKey,
  RevokeGrantInput,
  RevokeSessionsInput,
  StaffPreset,
  SuperAdminGrantInput,
  SuperAdminRevokeInput,
} from '@agri-erp/shared';

export class StaffAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'StaffAccessError';
  }
}

interface Envelope<T> {
  data?: T;
  page?: { cursor: string | null; hasMore: boolean };
  error?: { code: string; message: string; fields?: Record<string, string> };
}

async function call<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok) {
    throw new StaffAccessError(
      res.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? `Request failed (${res.status})`,
      body.error?.fields,
    );
  }
  return body;
}

const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(body) });

export interface MyAccess {
  user_id: string;
  role: string;
  permissions: { key: PermissionKey; platform: boolean; state_ids: string[] }[];
  is_super_admin: boolean;
  super_admin_exists: boolean;
  can_bootstrap_super_admin: boolean;
}

export interface Grant {
  id: string;
  user_id: string;
  preset: StaffPreset;
  scope: 'platform' | 'states';
  state_ids: string[];
  reason: string;
  granted_by: string;
  granted_at: string;
}

export interface StaffWithGrants {
  id: string;
  name: string;
  role: string;
  state_id: string | null;
  last_activity_at: string | null;
  legacy_admin: boolean;
  grants: Grant[];
}

export async function myAccess(): Promise<MyAccess> {
  const body = await call<MyAccess>('/api/admin/staff-access/me');
  if (!body.data) throw new StaffAccessError(500, 'empty', 'No answer from the server.');
  return body.data;
}

export async function listStaffAccess(): Promise<StaffWithGrants[]> {
  return (await call<StaffWithGrants[]>('/api/admin/staff-access')).data ?? [];
}

export const grantPreset = (input: GrantPresetInput) =>
  post<Grant>('/api/admin/staff-access/grants', input);

export const revokeGrant = (grantId: string, input: RevokeGrantInput) =>
  post(`/api/admin/staff-access/grants/${encodeURIComponent(grantId)}/revoke`, input);

export const grantSuperAdmin = (input: SuperAdminGrantInput) =>
  post<Grant>('/api/admin/staff-access/super-admin', input);

export const revokeSuperAdmin = (grantId: string, input: SuperAdminRevokeInput) =>
  post(`/api/admin/staff-access/super-admin/${encodeURIComponent(grantId)}/revoke`, input);

export const revokeSessions = (userId: string, input: RevokeSessionsInput) =>
  post(`/api/admin/staff-access/users/${encodeURIComponent(userId)}/revoke-sessions`, input);

export interface AccessLogEntry {
  id: string;
  actor_kind: 'user' | 'officer' | 'buyer' | 'farmer';
  actor_id: string;
  actor_name: string | null;
  event: AccessEvent;
  occurred_at: string;
  device_label: string | null;
  last_activity_at: string | null;
}

export interface AccessLogQuery {
  name?: string;
  actor_kind?: string;
  actor_id?: string;
  event?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export async function listAccessLogs(
  query: AccessLogQuery,
): Promise<{ rows: AccessLogEntry[]; cursor: string | null; hasMore: boolean }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const body = await call<AccessLogEntry[]>(`/api/admin/access-logs?${qs.toString()}`);
  return {
    rows: body.data ?? [],
    cursor: body.page?.cursor ?? null,
    hasMore: body.page?.hasMore ?? false,
  };
}
