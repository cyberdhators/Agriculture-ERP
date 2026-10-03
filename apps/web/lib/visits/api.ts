// Client data layer for extension visits (deliverable (d), C-8). It calls the
// live B8 routes — /api/visits, /api/visits/:id, /api/farmers/:id/visits and
// /api/visits/:id/attachments — through the standard response envelope
// (CONVENTIONS §3) and maps the API's present() shape onto the view types the
// screens render. Authorization, scope and validation all live on the server;
// this module never talks to the database. Gated by NEXT_PUBLIC_USE_LIVE_VISITS
// (off = the fixtures in ./fixtures).

import { correctVisitSchema, declareAttachmentSchema } from '@agri-erp/shared';
import type {
  AttachmentFailureCode,
  AttachmentKind,
  AttachmentStatus,
  CorrectVisit,
  DeclareAttachment,
  GeoJsonPoint,
  RecordVisit,
  VisitTopic,
} from '@agri-erp/shared';

/** Flip to live data with `NEXT_PUBLIC_USE_LIVE_VISITS=1`. Off = fixtures. */
export const LIVE_VISITS = process.env.NEXT_PUBLIC_USE_LIVE_VISITS === '1';

/** An error carried by an API error body (CONVENTIONS §4), with its status. */
export class VisitApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly rule?: string,
  ) {
    super(message);
    this.name = 'VisitApiError';
  }
}

/** One attachment, as `presentAttachment()` gives it (C-8.7). */
export interface VisitAttachment {
  id: string;
  visit_id: string;
  kind: AttachmentKind;
  status: AttachmentStatus;
  /** The sentence the officer reads beside it. Written by the server, never here. */
  message: string;
  content_type: string;
  byte_size: number;
  captured_at: string;
  declared_at: string;
  arrived_at: string | null;
  failed_at: string | null;
  failure_code: AttachmentFailureCode | null;
}

/**
 * One visit, as `presentVisit()` gives it. `position` and `gps_accuracy_m` are
 * present only for the reader entitled to the point (C-8.4); everyone else
 * receives the visit without them.
 */
export interface Visit {
  id: string;
  farmer_id: string;
  officer_id: string;
  payam_id: string;
  county_id: string;
  state_id: string;
  visited_at: string;
  received_at: string;
  observation: string | null;
  advice: string;
  topics: VisitTopic[];
  duration_minutes: number | null;
  attendee_count: number | null;
  follow_up_of: string | null;
  created_at: string;
  updated_at: string;
  attachments: VisitAttachment[];
  position?: GeoJsonPoint;
  gps_accuracy_m?: number;
}

/** A page of visits, newest received first (C-8.5). */
export interface VisitPage {
  visits: Visit[];
  cursor: string | null;
  hasMore: boolean;
}

/** Filters for a visit list. Dates filter the server's moment (C-8.5). */
export interface VisitListParams {
  farmer?: string;
  officer?: string;
  payam?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

/** The subset of `presentAttachment()` this client reads. */
type AttachmentDto = VisitAttachment;

/** The subset of `presentVisit()` this client reads. */
interface VisitDto {
  id: string;
  farmer_id: string;
  officer_id: string;
  payam_id: string;
  county_id: string;
  state_id: string;
  visited_at: string;
  received_at: string;
  observation: string | null;
  advice: string;
  topics: VisitTopic[];
  duration_minutes: number | null;
  attendee_count: number | null;
  follow_up_of: string | null;
  created_at: string;
  updated_at: string;
  attachments?: AttachmentDto[];
  position?: GeoJsonPoint;
  gps_accuracy_m?: number;
}

/** Map one API attachment row onto the view type. */
export function toAttachment(row: AttachmentDto): VisitAttachment {
  return {
    id: row.id,
    visit_id: row.visit_id,
    kind: row.kind,
    status: row.status,
    message: row.message,
    content_type: row.content_type,
    byte_size: row.byte_size,
    captured_at: row.captured_at,
    declared_at: row.declared_at,
    arrived_at: row.arrived_at,
    failed_at: row.failed_at,
    failure_code: row.failure_code,
  };
}

/** Map one API visit row onto the view type. Absent attachments become []. */
export function toVisit(row: VisitDto): Visit {
  const visit: Visit = {
    id: row.id,
    farmer_id: row.farmer_id,
    officer_id: row.officer_id,
    payam_id: row.payam_id,
    county_id: row.county_id,
    state_id: row.state_id,
    visited_at: row.visited_at,
    received_at: row.received_at,
    observation: row.observation,
    advice: row.advice,
    topics: row.topics,
    duration_minutes: row.duration_minutes,
    attendee_count: row.attendee_count,
    follow_up_of: row.follow_up_of,
    created_at: row.created_at,
    updated_at: row.updated_at,
    attachments: (row.attachments ?? []).map(toAttachment),
  };
  if (row.position) visit.position = row.position;
  if (row.gps_accuracy_m !== undefined) visit.gps_accuracy_m = row.gps_accuracy_m;
  return visit;
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
    throw new VisitApiError(
      res.status,
      err?.code ?? 'unknown',
      err?.message ?? `Request failed (${res.status})`,
      err?.rule,
    );
  }
  return body;
}

function toQuery(params: VisitListParams): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, String(value));
  }
  const query = qs.toString();
  return query ? `?${query}` : '';
}

function toPage(body: Envelope<VisitDto[]>): VisitPage {
  return {
    visits: (body.data ?? []).map(toVisit),
    cursor: body.page?.cursor ?? null,
    hasMore: body.page?.hasMore ?? false,
  };
}

/** GET /api/visits — visits in the caller's scope, newest received first. */
export async function listVisits(params: VisitListParams = {}): Promise<VisitPage> {
  return toPage(await request<VisitDto[]>(`/api/visits${toQuery(params)}`));
}

/** GET /api/farmers/:id/visits — one farmer's visits, scoped. */
export async function listFarmerVisits(
  farmerId: string,
  params: VisitListParams = {},
): Promise<VisitPage> {
  const path = `/api/farmers/${encodeURIComponent(farmerId)}/visits${toQuery(params)}`;
  return toPage(await request<VisitDto[]>(path));
}

/** GET /api/visits/:id — one visit with its attachments. */
export async function getVisit(id: string): Promise<Visit> {
  const body = await request<VisitDto>(`/api/visits/${encodeURIComponent(id)}`);
  if (!body.data) throw new VisitApiError(500, 'empty', 'No visit in the response');
  return toVisit(body.data);
}

/** POST /api/farmers/:id/visits — the farmer's officer records a visit (C-8.1). */
export async function createVisit(farmerId: string, input: RecordVisit): Promise<Visit> {
  const body = await request<VisitDto>(`/api/farmers/${encodeURIComponent(farmerId)}/visits`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!body.data) throw new VisitApiError(500, 'empty', 'No visit in the response');
  return toVisit(body.data);
}

/** GET /api/visits/:id/attachments — the visit's attachments and their state. */
export async function listVisitAttachments(visitId: string): Promise<VisitAttachment[]> {
  const body = await request<AttachmentDto[]>(
    `/api/visits/${encodeURIComponent(visitId)}/attachments`,
  );
  return (body.data ?? []).map(toAttachment);
}

/**
 * THE FOLLOW-UP CHAIN. `GET /api/visits/:id/chain` (C-8.3).
 *
 * Every earlier visit from the first down to this one, then this one, then its
 * direct follow-ups. Scoped by the visit itself -- `loadVisibleVisit` answers
 * 404 outside the caller's scope -- and the chain never leaves the farmer, so
 * what is visible for one link is visible for all.
 *
 * A REMOVED ANCESTOR KEEPS ITS PLACE AS AN ID AND NOTHING ELSE (C-8.11). It is
 * not dropped, because dropping it would silently reorder the history, and it
 * is not filled in with a placeholder, because nothing about it may be read.
 * `RemovedLink` is that shape, and callers must tell the two apart.
 */
export interface RemovedLink {
  id: string;
  removed: true;
}

export type ChainLink = Visit | RemovedLink;

export const isRemovedLink = (link: ChainLink): link is RemovedLink =>
  (link as RemovedLink).removed === true;

export interface VisitChain {
  earlier: ChainLink[];
  visit: Visit;
  follow_ups: Visit[];
}

export async function getVisitChain(id: string): Promise<VisitChain> {
  const body = await request<{
    earlier: (VisitDto | RemovedLink)[];
    visit: VisitDto;
    follow_ups: VisitDto[];
  }>(`/api/visits/${encodeURIComponent(id)}/chain`);
  if (!body.data) throw new VisitApiError(500, 'empty', 'No chain in the response');
  return {
    earlier: body.data.earlier.map((link) =>
      (link as RemovedLink).removed === true
        ? ({ id: link.id, removed: true } as RemovedLink)
        : toVisit(link as VisitDto),
    ),
    visit: toVisit(body.data.visit),
    follow_ups: body.data.follow_ups.map(toVisit),
  };
}

/* ---- Attachments: the row, then the bytes, then the word ---------------- */

/**
 * THE THREE STEPS, AND WHY THEY ARE THREE.
 *
 * An attachment is not a field on a visit. The visit is complete and saved
 * first; the file follows, and may never arrive. So:
 *
 *   1. DECLARE (`POST /api/visits/:id/attachments`) writes the row and returns
 *      a short-lived grant for one object path. The size and type are judged
 *      HERE, before a byte travels: an over-large photo is refused now.
 *   2. UPLOAD puts the bytes straight to Storage with that grant. This is the
 *      only step that does not touch our API.
 *   3. CONFIRM (`.../confirm`) asks the server to check what actually landed
 *      against what was declared. The server, not the phone, decides that it
 *      arrived -- a grant is never a grant to store anything.
 *
 * `fail` is the phone saying it gave up, so the row stops claiming to be on its
 * way. None of this is a queue: there is no retry loop, no background sync and
 * nothing kept on the device. Re-declaring the same id is how "send it again"
 * works, and that is a deliberate act by the officer.
 */
export interface UploadGrant {
  url: string;
  token: string;
  expires_at: string;
}

export interface DeclaredAttachment extends VisitAttachment {
  upload?: UploadGrant;
}

export async function declareAttachment(
  visitId: string,
  input: DeclareAttachment,
): Promise<DeclaredAttachment> {
  const parsed = declareAttachmentSchema.parse(input);
  const body = await request<AttachmentDto & { upload?: UploadGrant }>(
    `/api/visits/${encodeURIComponent(visitId)}/attachments`,
    { method: 'POST', body: JSON.stringify(parsed) },
  );
  if (!body.data) throw new VisitApiError(500, 'empty', 'No attachment in the response');
  const attachment: DeclaredAttachment = toAttachment(body.data);
  if (body.data.upload) attachment.upload = body.data.upload;
  return attachment;
}

/**
 * Step two: the bytes, straight to Storage with the grant's own token. Never
 * through our API -- the file does not pass through the application at all.
 */
export async function uploadAttachmentBytes(grant: UploadGrant, file: Blob): Promise<void> {
  const res = await fetch(grant.url, {
    method: 'PUT',
    headers: { authorization: `Bearer ${grant.token}`, 'content-type': file.type },
    body: file,
  });
  if (!res.ok) {
    throw new VisitApiError(res.status, 'upload_failed', 'The file did not reach the store.');
  }
}

/** Step three: the server checks what landed against what was declared. */
export async function confirmAttachment(
  visitId: string,
  attachmentId: string,
): Promise<VisitAttachment> {
  const body = await request<AttachmentDto>(
    `/api/visits/${encodeURIComponent(visitId)}/attachments/${encodeURIComponent(attachmentId)}/confirm`,
    { method: 'POST' },
  );
  if (!body.data) throw new VisitApiError(500, 'empty', 'No attachment in the response');
  return toAttachment(body.data);
}

/**
 * A READ LINK FOR AN ARRIVED ATTACHMENT. `GET .../attachments/:aid/link`.
 *
 * The bucket is private and has no public policy, so a file is never at a
 * guessable address: the server issues a link per request that expires in
 * minutes (C-8.8), and scope is the visit's -- outside it the visit is not
 * found, so neither is the file.
 *
 * ONLY AN ARRIVED ATTACHMENT HAS ONE. A waiting or failed row has nothing to
 * open and the route answers 409 `attachment_not_received`, so the screen
 * offers the action only for the state that has something behind it.
 *
 * EVERY ONE OF THESE IS AUDITED. The link outlives the request and can be
 * forwarded, so who asked for what and when is recorded. Fetch it when the
 * officer asks to open the file, never speculatively for a list.
 */
export interface AttachmentLink {
  attachment_id: string;
  content_type: string;
  url: string;
  expires_at: string;
}

export async function getAttachmentLink(
  visitId: string,
  attachmentId: string,
): Promise<AttachmentLink> {
  const body = await request<AttachmentLink>(
    `/api/visits/${encodeURIComponent(visitId)}/attachments/${encodeURIComponent(attachmentId)}/link`,
  );
  if (!body.data) throw new VisitApiError(500, 'empty', 'No link in the response');
  return body.data;
}

/** The phone gave up. The row stops claiming to be on its way. */
export async function failAttachment(
  visitId: string,
  attachmentId: string,
): Promise<VisitAttachment> {
  const body = await request<AttachmentDto>(
    `/api/visits/${encodeURIComponent(visitId)}/attachments/${encodeURIComponent(attachmentId)}/fail`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  if (!body.data) throw new VisitApiError(500, 'empty', 'No attachment in the response');
  return toAttachment(body.data);
}

/* ---- Administrative correction and removal ---------------------------- */

/**
 * CORRECT A VISIT. `PATCH /api/visits/:id`, administrator or the visit's own
 * officer — and for the officer only within the correction window the server
 * measures from ITS moment, not the phone's.
 *
 * WHAT MAY BE CORRECTED IS THE SCHEMA'S DECISION, NOT THIS SCREEN'S.
 * `correctVisitSchema` accepts the observation, the advice, the topics, the
 * duration, the attendee count and a follow-up link. It does NOT accept the
 * position, the GPS accuracy, the farmer, the officer or the moment of the
 * visit — those are what the field recorded, and an administrator correcting a
 * record is not re-recording the fieldwork. An empty body is refused.
 *
 * The body is validated here by the same shared schema the route uses, so the
 * form cannot disagree with the server about what a correction is.
 */
export async function correctVisit(id: string, input: CorrectVisit): Promise<Visit> {
  const parsed = correctVisitSchema.parse(input);
  const body = await request<VisitDto>(`/api/visits/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(parsed),
  });
  if (!body.data) throw new VisitApiError(500, 'empty', 'No visit in the response');
  return toVisit(body.data);
}

/**
 * SOFT REMOVAL of a visit. `DELETE /api/visits/:id`, administrator only.
 *
 * Stamps `deleted_at`: the visit leaves every list, count, export and reach
 * figure, and its row and audit history remain. Nothing restores it — no route
 * offers that — so no screen should imply otherwise.
 */
export async function removeVisit(id: string): Promise<void> {
  await request<unknown>(`/api/visits/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
