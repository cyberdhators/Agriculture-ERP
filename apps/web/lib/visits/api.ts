// Client data layer for extension visits (deliverable (d), C-8). It calls the
// live B8 routes — /api/visits, /api/visits/:id, /api/farmers/:id/visits and
// /api/visits/:id/attachments — through the standard response envelope
// (CONVENTIONS §3) and maps the API's present() shape onto the view types the
// screens render. Authorization, scope and validation all live on the server;
// this module never talks to the database. Gated by NEXT_PUBLIC_USE_LIVE_VISITS
// (off = the fixtures in ./fixtures).

import { correctVisitSchema } from '@agri-erp/shared';
import type {
  AttachmentFailureCode,
  AttachmentKind,
  AttachmentStatus,
  CorrectVisit,
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
