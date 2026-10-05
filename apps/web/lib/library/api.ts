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
    byte_size: row.byte_size,
    description: row.description,
    published: row.published,
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

/**
 * THE THREE STEPS OF PUTTING A FILE IN THE LIBRARY.
 *
 *   1. REGISTER the card. The server mints the id, derives the object path
 *      from it, and returns a short-lived grant for that one path. The row is
 *      born unpublished whatever was asked for, because no bytes have arrived.
 *   2. UPLOAD the bytes straight to Storage with that grant. This is the only
 *      step that does not touch our API; the file never passes through it.
 *   3. PUBLISH with a PATCH. The server asks the provider what is actually at
 *      the path and refuses if nothing is there or the size disagrees, so a
 *      half-uploaded file is never offered to an officer.
 *
 * The client never names a path, a bucket, or an address. It names a KIND of
 * file, and the server decides where it goes.
 */
export interface ResourceUploadGrant {
  url: string;
  token: string;
  expires_in_minutes: number;
}

export interface RegisteredResource {
  row: LearningResourceRow;
  upload: ResourceUploadGrant;
}

export async function registerLearningResource(
  input: Omit<LearningResourceInput, 'published'> & { content_type: string },
): Promise<RegisteredResource> {
  const body = await request<LearningResourceApi & { upload: ResourceUploadGrant }>(
    '/api/learning-resources',
    { method: 'POST', body: JSON.stringify({ ...input, published: false }) },
  );
  if (!body.data) throw new LibraryApiError(500, 'empty', 'No resource in the response');
  return { row: toRow(body.data), upload: body.data.upload };
}

/** Step two: the bytes, straight to Storage. Never through our API. */
export async function uploadResourceBytes(grant: ResourceUploadGrant, file: Blob): Promise<void> {
  const res = await fetch(grant.url, {
    method: 'PUT',
    headers: { authorization: `Bearer ${grant.token}`, 'content-type': file.type },
    body: file,
  });
  if (!res.ok) {
    throw new LibraryApiError(res.status, 'upload_failed', 'The file did not reach the store.');
  }
}

/**
 * A READ LINK FOR ONE RESOURCE. `GET /api/learning-resources/:id/link`.
 *
 * Asked for at the moment an officer opens something, never in advance for a
 * list: every issue is audited, and a link fetched speculatively would record
 * a reading that never happened. An unpublished resource is not found to an
 * officer, exactly as it is absent from their list.
 */
export interface ResourceLink {
  resource_id: string;
  title: string;
  format: string;
  url: string;
  expires_at: string;
}

export async function getLearningResourceLink(id: string): Promise<ResourceLink> {
  const body = await request<ResourceLink>(
    `/api/learning-resources/${encodeURIComponent(id)}/link`,
  );
  if (!body.data) throw new LibraryApiError(500, 'empty', 'No link in the response');
  return body.data;
}

/** Soft delete. The file stays in storage; the row keeps its history (C-13). */
export async function removeLearningResource(id: string): Promise<void> {
  await request<null>(`/api/learning-resources/${id}`, { method: 'DELETE' });
}
