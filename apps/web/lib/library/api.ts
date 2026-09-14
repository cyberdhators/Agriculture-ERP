// Client data layer for the learning library (deliverable (j), C-13). It calls
// the live P1 routes — /api/learning-resources and /api/learning-resources/:id
// — through the standard response envelope (CONVENTIONS §3) and maps the API's
// present() shape onto the row the screens already render. A non-administrator
// is served published cards only; that rule is the route's, not this file's.
// Gated by NEXT_PUBLIC_USE_LIVE_LIBRARY (off = the fixtures in lib/fixtures/p1).
import type { LearningResourceInput } from '@agri-erp/shared';

import type { LearningResourceRow } from '@/lib/fixtures/p1';

/** Flip to live data with `NEXT_PUBLIC_USE_LIVE_LIBRARY=1`. Off = fixtures. */
export const LIVE_LIBRARY = process.env.NEXT_PUBLIC_USE_LIVE_LIBRARY === '1';

/** An error carried by an API error body (CONVENTIONS §4), with its status. */
export class LibraryApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly rule?: string,
  ) {
    super(message);
    this.name = 'LibraryApiError';
  }
}

/** One resource as the route's present() gives it. */
export interface LearningResourceApi {
  id: string;
  title: string;
  topic: LearningResourceRow['topic'];
  crop: LearningResourceRow['crop'];
  language: LearningResourceRow['language'];
  format: LearningResourceRow['format'];
  storage_path: string;
  byte_size: number;
  description: string | null;
  published: boolean;
  uploaded_at: string;
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
    throw new LibraryApiError(
      res.status,
      err?.code ?? 'request_failed',
      err?.message ?? `Request failed (${res.status})`,
      err?.rule,
    );
  }
  return body;
}

/** The route never returns a soft-deleted row and does not expose the uploader's id. */
export function toRow(resource: LearningResourceApi): LearningResourceRow {
  return { ...resource, uploaded_by: null, deleted_at: null };
}

/** The request body the route validates: the input fields only. */
export function toInput(row: LearningResourceRow): LearningResourceInput {
  return {
    title: row.title,
    topic: row.topic,
    crop: row.crop,
    language: row.language,
    format: row.format,
    storage_path: row.storage_path,
    byte_size: row.byte_size,
    description: row.description,
    published: row.published,
  };
}

/** Every resource the caller may see, following the cursor to the end. */
export async function listLearningResources(): Promise<LearningResourceRow[]> {
  const out: LearningResourceRow[] = [];
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ limit: '100' });
    if (cursor) qs.set('cursor', cursor);
    const body: Envelope<LearningResourceApi[]> = await request(`/api/learning-resources?${qs}`);
    for (const r of body.data ?? []) out.push(toRow(r));
    cursor = body.page?.hasMore ? (body.page.cursor ?? null) : null;
  } while (cursor);
  return out;
}

/** Create or update. A publish flip is a PATCH with `published` changed; the route audits it as its own event. */
export async function saveLearningResource(
  row: LearningResourceRow,
  exists: boolean,
): Promise<LearningResourceRow> {
  const body = await request<LearningResourceApi>(
    exists ? `/api/learning-resources/${row.id}` : '/api/learning-resources',
    { method: exists ? 'PATCH' : 'POST', body: JSON.stringify(toInput(row)) },
  );
  if (!body.data) throw new LibraryApiError(500, 'empty', 'No resource in the response');
  return toRow(body.data);
}

/** Soft delete. The file stays in storage; the row keeps its history (C-13). */
export async function removeLearningResource(id: string): Promise<void> {
  await request<null>(`/api/learning-resources/${id}`, { method: 'DELETE' });
}
