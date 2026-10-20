// Client data layer for the learning library (deliverable (j), C-13). It calls
// the live P1 routes — /api/learning-resources and /api/learning-resources/:id
// — through the standard response envelope (CONVENTIONS §3) and maps the API's
// present() shape onto the row the screens already render. A non-administrator
// is served published cards only; that rule is the route's, not this file's.
// Gated by NEXT_PUBLIC_USE_LIVE_LIBRARY (off = the fixtures in lib/fixtures/p1).
import type { LearningAction, LearningResourceInput } from '@agri-erp/shared';

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
  // 2026-10-22: Advice & Learning.
  status: LearningResourceRow['status'];
  topics: LearningResourceRow['topics'];
  title_ar: string | null;
  description_ar: string | null;
  submitted_at: string | null;
  submitted_by_name: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  review_note: string | null;
  published_at: string | null;
  published_by_name: string | null;
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

/**
 * The request body the route validates: the input fields only. 2026-10-22: the
 * shared advice topics and the Arabic title and summary; no `published` -- a
 * guide goes public only through the publish move. The library's own `topic`
 * is not sent: the route keeps it or derives it from the first advice topic.
 */
export function toInput(row: LearningResourceRow): LearningResourceInput {
  return {
    title: row.title,
    topics: row.topics,
    title_ar: row.title_ar,
    crop: row.crop,
    language: row.language,
    format: row.format,
    storage_path: row.storage_path,
    byte_size: row.byte_size,
    description: row.description,
    description_ar: row.description_ar,
  };
}

/**
 * Every resource the caller may see, following the cursor to the end.
 *
 * NOT a first page mistaken for the whole: the loop runs until `hasMore` is
 * false. The catalogue is a small reference shelf rather than a register, so
 * reading all of it is what lets the format tallies and the title filter on
 * the screen be accurate instead of counting whatever happened to load. The
 * route's own topic, crop and language filters are therefore not needed to
 * make the screen honest — it narrows a COMPLETE set, which is the thing that
 * matters.
 */
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

/** Create or update the card. Moving it through the workflow is transitionLearningResource. */
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

/**
 * 2026-10-22: one move through the workflow -- submit, return (with a note),
 * publish, unpublish. The route checks the permission the move needs and the
 * state it starts from, and audits it as its own event.
 */
export async function transitionLearningResource(
  id: string,
  action: LearningAction,
  note?: string,
): Promise<LearningResourceRow> {
  const body = await request<LearningResourceApi>(`/api/learning-resources/${id}/transition`, {
    method: 'POST',
    body: JSON.stringify(note === undefined ? { action } : { action, note }),
  });
  if (!body.data) throw new LibraryApiError(500, 'empty', 'No resource in the response');
  return toRow(body.data);
}
