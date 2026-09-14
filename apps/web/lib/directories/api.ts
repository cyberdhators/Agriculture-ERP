// Client data layer for the three directories (deliverable (i), C-13). It calls
// the live P1 routes — /api/directory-entries and /api/directory-entries/:id —
// through the standard response envelope (CONVENTIONS §3) and maps the API's
// present() shape onto the row the screens already render. Authorization,
// scope (an officer's read is their state) and validation all live on the
// server; this module never talks to the database. Gated by
// NEXT_PUBLIC_USE_LIVE_DIRECTORIES (off = the fixtures in lib/fixtures/p1).
import type { DirectoryEntryInput } from '@agri-erp/shared';

import type { DirectoryEntryRow } from '@/lib/fixtures/p1';

/** Flip to live data with `NEXT_PUBLIC_USE_LIVE_DIRECTORIES=1`. Off = fixtures. */
export const LIVE_DIRECTORIES = process.env.NEXT_PUBLIC_USE_LIVE_DIRECTORIES === '1';

/** An error carried by an API error body (CONVENTIONS §4), with its status. */
export class DirectoryApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly rule?: string,
  ) {
    super(message);
    this.name = 'DirectoryApiError';
  }
}

/** One entry as the route's present() gives it. No audit columns: those are the audit log's. */
export interface DirectoryEntryApi {
  id: string;
  entry_type: DirectoryEntryRow['entry_type'];
  name: string;
  description: string | null;
  services: string[];
  contact_name: string | null;
  phone: string;
  alt_phone: string | null;
  email: string | null;
  physical_address: string | null;
  location: { latitude: number; longitude: number } | null;
  payam_id: string;
  state_id: string;
  provider_class: DirectoryEntryRow['provider_class'];
  last_verified_at: string;
  active: boolean;
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
    throw new DirectoryApiError(
      res.status,
      err?.code ?? 'request_failed',
      err?.message ?? `Request failed (${res.status})`,
      err?.rule,
    );
  }
  return body;
}

/**
 * The route carries no created/updated stamps (they belong to the audit log,
 * C-4) and never returns a soft-deleted row (it reads the _active view). The
 * screens' row type has those columns, so they are filled with what is true:
 * the verification date stands in for both stamps, and deleted_at is null.
 */
export function toRow(entry: DirectoryEntryApi): DirectoryEntryRow {
  return {
    ...entry,
    verified_by: null,
    created_at: entry.last_verified_at,
    updated_at: entry.last_verified_at,
    deleted_at: null,
  };
}

/** The request body the route validates: the input fields only, nothing the server owns. */
export function toInput(row: DirectoryEntryRow): DirectoryEntryInput {
  return {
    entry_type: row.entry_type,
    name: row.name,
    description: row.description,
    services: row.services,
    contact_name: row.contact_name,
    phone: row.phone,
    alt_phone: row.alt_phone,
    email: row.email,
    physical_address: row.physical_address,
    location: row.location,
    payam_id: row.payam_id,
    state_id: row.state_id,
    provider_class: row.provider_class,
    last_verified_at: row.last_verified_at,
    active: row.active,
  };
}

/**
 * Every entry the caller may see, following the cursor to the end. The
 * directories are a few hundred rows at most and the screen filters them
 * client-side, so one full read is the honest shape. Inactive entries come
 * too: the route returns them and the screen decides who sees them (C-13).
 */
export async function listDirectoryEntries(): Promise<DirectoryEntryRow[]> {
  const out: DirectoryEntryRow[] = [];
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ limit: '100' });
    if (cursor) qs.set('cursor', cursor);
    const body: Envelope<DirectoryEntryApi[]> = await request(`/api/directory-entries?${qs}`);
    for (const e of body.data ?? []) out.push(toRow(e));
    cursor = body.page?.hasMore ? (body.page.cursor ?? null) : null;
  } while (cursor);
  return out;
}

/** Create (no id yet) or update (has an id the server knows). Returns the row as saved. */
export async function saveDirectoryEntry(
  row: DirectoryEntryRow,
  exists: boolean,
): Promise<DirectoryEntryRow> {
  const body = await request<DirectoryEntryApi>(
    exists ? `/api/directory-entries/${row.id}` : '/api/directory-entries',
    { method: exists ? 'PATCH' : 'POST', body: JSON.stringify(toInput(row)) },
  );
  if (!body.data) throw new DirectoryApiError(500, 'empty', 'No entry in the response');
  return toRow(body.data);
}

/**
 * Soft delete (C-13, CLAUDE.md §4). The route sets deleted_at and active=false
 * in one audited transaction; the reason is kept on the screen's own record
 * because the route does not take one yet — see the HANDOFF note.
 */
export async function removeDirectoryEntry(id: string): Promise<void> {
  await request<null>(`/api/directory-entries/${id}`, { method: 'DELETE' });
}
