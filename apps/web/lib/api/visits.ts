import {
  ATTACHMENT_FAILURE_MESSAGES,
  ATTACHMENT_STATUS_MESSAGES,
  type AttachmentFailureCode,
  type AttachmentKind,
  type AttachmentStatus,
  DEFAULT_LIMIT,
  type GeoJsonPoint,
  MAX_LIMIT,
  type RecordVisit,
  VISIT_LIMITS,
  type VisitFilter,
  decodeCursor,
  encodeCursor,
  toIso,
  visitFilterSchema,
  zodErrorToApiError,
} from '@agri-erp/shared';
import { Prisma } from '@prisma/client';
import { type AuditTx } from './audit';
import { ApiFailure, conflict, invalidCursor, notFound, unprocessable } from './errors';
import { type Authenticated } from './require-role';
import { type RouteResult, paged } from './route';

/**
 * Extension visits (C-8). The one file that writes the visit's spatial SQL
 * and reads the visit and attachment tables.
 *
 * Two moments on every visit: `visited_at` is the device's, `received_at` is
 * the server's. Lists sort and page on the server's; coverage counts the
 * server's; the correction window runs from the server's (C-8.5, C-8.10).
 */

export interface VisitRow {
  id: string;
  farmer_id: string;
  officer_id: string;
  payam_id: string;
  county_id: string;
  state_id: string;
  position_geojson: string;
  gps_accuracy_m: string;
  observation: string | null;
  advice: string;
  topics: string[];
  duration_minutes: number | null;
  attendee_count: number | null;
  follow_up_of: string | null;
  visited_at: Date;
  received_at: Date;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  /** The farmer's caseload officer: the caseload key (C-8.9, C-8R). */
  caseload_officer_id: string | null;
}

export interface AttachmentRow {
  id: string;
  visit_id: string;
  kind: AttachmentKind;
  status: AttachmentStatus;
  storage_path: string;
  content_type: string;
  byte_size: number;
  captured_at: Date;
  grant_expires_at: Date;
  arrived_at: Date | null;
  failed_at: Date | null;
  failure_code: AttachmentFailureCode | null;
  created_by: string;
  created_at: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Selected from visit_active v (or visit v for history) joined to farmer fr. */
export const VISIT_COLUMNS = `
  v.id, v.farmer_id, v.officer_id, v.payam_id, v.county_id, v.state_id,
  extensions.ST_AsGeoJSON(v.position) AS position_geojson,
  v.gps_accuracy_m::text AS gps_accuracy_m,
  v.observation, v.advice, v.topics::text[] AS topics, v.duration_minutes, v.attendee_count,
  v.follow_up_of, v.visited_at, v.received_at, v.created_at, v.updated_at, v.deleted_at,
  fr.caseload_officer_id`;
export const VISIT_FROM = `FROM public.visit_active v JOIN public.farmer fr ON fr.id = v.farmer_id`;

export const ATTACHMENT_COLUMNS = `
  a.id, a.visit_id, a.kind::text AS kind, a.status::text AS status, a.storage_path, a.content_type,
  a.byte_size, a.captured_at, a.grant_expires_at, a.arrived_at, a.failed_at, a.failure_code,
  a.created_by, a.created_at`;

type Db = { $queryRawUnsafe: Prisma.TransactionClient['$queryRawUnsafe'] };

/** Caseload: the farmer's caseload officer. State: the visit's state. Admin: all (C-8.9). */
export function visitScopeClause(auth: Authenticated, params: unknown[]): string[] {
  if (auth.scope.kind === 'state') {
    params.push(auth.scope.stateId);
    return [`v.state_id = $${params.length}`];
  }
  if (auth.scope.kind === 'caseload') {
    params.push(auth.scope.officerId);
    return [`fr.caseload_officer_id = $${params.length}::uuid`];
  }
  return [];
}

export async function loadVisibleVisit(db: Db, id: string, auth: Authenticated): Promise<VisitRow> {
  if (!UUID.test(id)) throw notFound();
  const params: unknown[] = [id];
  const where = ['v.id = $1::uuid', ...visitScopeClause(auth, params)];
  const [row] = await db.$queryRawUnsafe<VisitRow[]>(
    `SELECT ${VISIT_COLUMNS} ${VISIT_FROM} WHERE ${where.join(' AND ')}`,
    ...params,
  );
  if (!row) throw notFound();
  return row;
}

export async function attachmentsOf(db: Db, visitIds: readonly string[]): Promise<AttachmentRow[]> {
  if (visitIds.length === 0) return [];
  return db.$queryRawUnsafe<AttachmentRow[]>(
    `SELECT ${ATTACHMENT_COLUMNS} FROM public.visit_attachment a
     WHERE a.visit_id = ANY($1::uuid[]) ORDER BY a.visit_id, a.captured_at, a.id`,
    visitIds,
  );
}

export async function loadAttachment(
  db: Db,
  visitId: string,
  attachmentId: string,
): Promise<AttachmentRow> {
  if (!UUID.test(attachmentId)) throw notFound();
  const [row] = await db.$queryRawUnsafe<AttachmentRow[]>(
    `SELECT ${ATTACHMENT_COLUMNS} FROM public.visit_attachment a
     WHERE a.visit_id = $1::uuid AND a.id = $2::uuid`,
    visitId,
    attachmentId,
  );
  if (!row) throw notFound();
  return row;
}

/**
 * C-8.4 with C-7.8's visibility: the standing point and its accuracy to
 * administrators and the visit's own officer. A visit's position is a named
 * person's field, as a boundary is (docs/DECISIONS.md, B8).
 */
export const canSeePosition = (auth: Authenticated, officerId: string): boolean =>
  auth.role === 'admin' || (auth.role === 'officer' && auth.principal.id === officerId);

/** An officer's own correction window, from the SERVER's moment (C-8.10). */
export const withinCorrectionWindow = (receivedAt: Date, now = new Date()): boolean =>
  now.getTime() - receivedAt.getTime() <= VISIT_LIMITS.correctionWindowHours * 3_600_000;

export function presentAttachment(a: AttachmentRow): Record<string, unknown> {
  return {
    id: a.id,
    visit_id: a.visit_id,
    kind: a.kind,
    status: a.status,
    // C-8.7: the sentence names the action, never the fault. Looked up, never written here.
    message:
      a.status === 'failed' && a.failure_code
        ? ATTACHMENT_FAILURE_MESSAGES[a.failure_code]
        : ATTACHMENT_STATUS_MESSAGES[a.status],
    content_type: a.content_type,
    byte_size: a.byte_size,
    captured_at: toIso(a.captured_at),
    declared_at: toIso(a.created_at),
    arrived_at: a.arrived_at ? toIso(a.arrived_at) : null,
    failed_at: a.failed_at ? toIso(a.failed_at) : null,
    failure_code: a.failure_code,
  };
}

export function presentVisit(
  v: VisitRow,
  attachments: readonly AttachmentRow[],
  auth: Authenticated,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: v.id,
    farmer_id: v.farmer_id,
    officer_id: v.officer_id,
    payam_id: v.payam_id,
    county_id: v.county_id,
    state_id: v.state_id,
    // Both moments, wherever a date is shown (C-8.5).
    visited_at: toIso(v.visited_at),
    received_at: toIso(v.received_at),
    observation: v.observation,
    advice: v.advice,
    topics: v.topics,
    duration_minutes: v.duration_minutes,
    attendee_count: v.attendee_count,
    follow_up_of: v.follow_up_of,
    created_at: toIso(v.created_at),
    updated_at: toIso(v.updated_at),
    attachments: attachments.filter((a) => a.visit_id === v.id).map(presentAttachment),
  };
  if (canSeePosition(auth, v.officer_id)) {
    out.position = JSON.parse(v.position_geojson) as unknown;
    out.gps_accuracy_m = Number(v.gps_accuracy_m);
  }
  return out;
}

/**
 * The follow-up target, judged before the database (owner's addition to
 * C-8.3), each refusal its own sentence: it exists for THIS farmer and is not
 * removed — one sentence for all three, because naming which would confirm
 * another farmer's record exists — and following it back never reaches this
 * visit. The trigger is the backstop.
 */
export async function checkFollowUp(
  tx: AuditTx,
  farmerId: string,
  visitId: string,
  followUpOf: string,
): Promise<void> {
  const [target] = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM public.visit WHERE id = $1::uuid AND farmer_id = $2::uuid AND deleted_at IS NULL`,
    followUpOf,
    farmerId,
  );
  if (!target) throw unprocessable('follow_up_not_found');
  if (followUpOf === visitId) throw unprocessable('follow_up_cycle');
  const [walk] = await tx.$queryRawUnsafe<{ cyclic: boolean }[]>(
    `WITH RECURSIVE chain AS (
       SELECT v.id, v.follow_up_of, 1 AS depth FROM public.visit v WHERE v.id = $1::uuid
       UNION ALL
       SELECT v.id, v.follow_up_of, c.depth + 1 FROM public.visit v JOIN chain c ON v.id = c.follow_up_of
       WHERE c.depth < 10000
     )
     SELECT EXISTS (SELECT 1 FROM chain WHERE id = $2::uuid) AS cyclic`,
    followUpOf,
    visitId,
  );
  if (walk?.cyclic) throw unprocessable('follow_up_cycle');
}

export interface InsertVisitInput {
  readonly body: RecordVisit;
  readonly farmer: { id: string; payam_id: string; county_id: string; state_id: string };
  readonly officerId: string;
}

const pointGeoJson = (p: GeoJsonPoint): string =>
  JSON.stringify({ type: 'Point', coordinates: p.coordinates });

export async function insertVisit(tx: AuditTx, input: InsertVisitInput): Promise<VisitRow> {
  const { body, farmer } = input;
  if (body.follow_up_of) await checkFollowUp(tx, farmer.id, body.id, body.follow_up_of);
  let rows: VisitRow[];
  try {
    rows = await tx.$queryRawUnsafe<VisitRow[]>(
      `WITH v AS (
         INSERT INTO public.visit
           (id, farmer_id, officer_id, payam_id, county_id, state_id, position, gps_accuracy_m,
            observation, advice, topics, duration_minutes, attendee_count, follow_up_of, visited_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
                 extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON($7), 4326)::extensions.geography,
                 $8, $9, $10, $11::public.visit_topic[], $12, $13, $14::uuid, $15::timestamptz)
         RETURNING *
       )
       SELECT ${VISIT_COLUMNS} FROM v JOIN public.farmer fr ON fr.id = v.farmer_id`,
      body.id,
      farmer.id,
      input.officerId,
      farmer.payam_id,
      farmer.county_id,
      farmer.state_id,
      pointGeoJson(body.position),
      body.gps_accuracy_m,
      body.observation ?? null,
      body.advice,
      body.topics,
      body.duration_minutes ?? null,
      body.attendee_count ?? null,
      body.follow_up_of ?? null,
      body.visited_at,
    );
  } catch (failure) {
    // 23505 on the primary key: the same client id arrived twice at once (B9's retry).
    const meta =
      failure instanceof Prisma.PrismaClientKnownRequestError
        ? (failure.meta as { code?: unknown } | undefined)
        : undefined;
    if (
      failure instanceof Prisma.PrismaClientKnownRequestError &&
      failure.code === 'P2010' &&
      meta?.code === '23505'
    ) {
      throw conflict('visit_already_exists');
    }
    throw failure;
  }
  const row = rows[0];
  if (!row) throw new Error('visit insert returned no row');
  return row;
}

/**
 * The chain (C-8.3): from the root down to this visit, in order, then this
 * visit's direct follow-ups. Ancestors are read from `visit`, not the active
 * view, so a removed link does not break the order; the presenter shows a
 * removed ancestor as its id and nothing else (C-8.11).
 */
export async function chainOf(
  db: Db,
  visit: VisitRow,
): Promise<{ ancestors: VisitRow[]; followUps: VisitRow[] }> {
  const ancestors = await db.$queryRawUnsafe<VisitRow[]>(
    `WITH RECURSIVE up AS (
       SELECT v.*, 0 AS depth FROM public.visit v WHERE v.id = $1::uuid
       UNION ALL
       SELECT v.*, up.depth + 1 FROM public.visit v JOIN up ON v.id = up.follow_up_of
       WHERE up.depth < 10000
     )
     SELECT ${VISIT_COLUMNS} FROM (SELECT * FROM up WHERE depth > 0) v
     JOIN public.farmer fr ON fr.id = v.farmer_id
     ORDER BY v.depth DESC`,
    visit.id,
  );
  const followUps = await db.$queryRawUnsafe<VisitRow[]>(
    `SELECT ${VISIT_COLUMNS} ${VISIT_FROM} WHERE v.follow_up_of = $1::uuid
     ORDER BY v.received_at ASC, v.id ASC`,
    visit.id,
  );
  return { ancestors, followUps };
}

/** Audit fields of a visit: never the substance, never the point (C-8.12, C-8.13). */
export const visitAuditFields = (v: VisitRow): Record<string, unknown> => ({
  farmer_id: v.farmer_id,
  officer_id: v.officer_id,
  payam_id: v.payam_id,
  state_id: v.state_id,
  topics: v.topics,
  duration_minutes: v.duration_minutes,
  attendee_count: v.attendee_count,
  follow_up_of: v.follow_up_of,
  visited_at: toIso(v.visited_at),
  received_at: toIso(v.received_at),
  gps_accuracy_m: Number(v.gps_accuracy_m),
});

/**
 * One page of visits, newest RECEIVED first (C-8.5), scoped, with optional
 * filters. Used by both lists so they cannot page differently.
 */
export async function pageVisits(
  db: Db,
  auth: Authenticated,
  filter: VisitFilter,
  fixed: { farmerId?: string } = {},
): Promise<RouteResult> {
  let limit = DEFAULT_LIMIT;
  if (filter.limit !== undefined) {
    const n = Number(filter.limit);
    if (!Number.isInteger(n) || n < 1) throw invalidCursor();
    limit = Math.min(n, MAX_LIMIT);
  }
  const params: unknown[] = [];
  const where: string[] = visitScopeClause(auth, params);
  const add = (sql: (i: number) => string, value: unknown) => {
    params.push(value);
    where.push(sql(params.length));
  };
  if (fixed.farmerId) add((i) => `v.farmer_id = $${i}::uuid`, fixed.farmerId);
  else if (filter.farmer) add((i) => `v.farmer_id = $${i}::uuid`, filter.farmer);
  if (filter.officer) add((i) => `v.officer_id = $${i}::uuid`, filter.officer);
  if (filter.payam) add((i) => `v.payam_id = $${i}`, filter.payam);
  if (filter.from) add((i) => `v.received_at >= $${i}::timestamptz`, filter.from);
  if (filter.to) add((i) => `v.received_at <= $${i}::timestamptz`, filter.to);
  // C-9.9: the download filter, on the server's moment of last change.
  if (filter.updated_since) add((i) => `v.updated_at > $${i}::timestamptz`, filter.updated_since);
  if (filter.cursor !== undefined) {
    const cursor = decodeCursor(filter.cursor);
    if (!cursor) throw invalidCursor();
    params.push(cursor.createdAt, cursor.id);
    where.push(
      `(v.received_at, v.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
    );
  }
  const rows = await db.$queryRawUnsafe<VisitRow[]>(
    `SELECT ${VISIT_COLUMNS} ${VISIT_FROM}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY v.received_at DESC, v.id DESC
     LIMIT ${limit + 1}`,
    ...params,
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const attachments = await attachmentsOf(
    db,
    page.map((v) => v.id),
  );
  return paged(
    page.map((v) => presentVisit(v, attachments, auth)),
    {
      cursor:
        hasMore && last ? encodeCursor({ createdAt: toIso(last.received_at), id: last.id }) : null,
      hasMore,
    },
  );
}

/** Parses a list's query string against the visit filter schema, 400 on refusal. */
export function parseVisitFilter(request: Request): VisitFilter {
  const parsed = visitFilterSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const { body } = zodErrorToApiError(parsed.error);
    throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
  }
  return parsed.data;
}

/**
 * C-9.2: does a retried visit describe the one already stored? The fields the
 * client sent, after the schema's normalisation; topics as a set; the point
 * by its coordinates; nothing the server set.
 */
export function visitMatches(body: RecordVisit, row: VisitRow, officerId: string): boolean {
  const stored = JSON.parse(row.position_geojson) as { coordinates: [number, number] };
  const sameSet = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
  const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
  return (
    row.officer_id === officerId &&
    new Date(row.visited_at).getTime() === new Date(body.visited_at).getTime() &&
    stored.coordinates[0] === body.position.coordinates[0] &&
    stored.coordinates[1] === body.position.coordinates[1] &&
    Number(row.gps_accuracy_m) === body.gps_accuracy_m &&
    same(row.observation, body.observation) &&
    row.advice === body.advice &&
    sameSet(row.topics, body.topics) &&
    same(row.duration_minutes, body.duration_minutes) &&
    same(row.attendee_count, body.attendee_count) &&
    same(row.follow_up_of, body.follow_up_of)
  );
}
