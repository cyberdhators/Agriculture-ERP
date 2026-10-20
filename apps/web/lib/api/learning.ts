import {
  ADVICE_TOPIC_FOR_LEARNING_TOPIC,
  LEARNING_TOPIC_FOR_ADVICE_TOPIC,
  holdsPermission,
  learningEditNeedsPublish,
  toIso,
  type AdviceTopic,
  type LearningResourceInput,
  type LearningStatus,
  type LearningTopic,
} from '@agri-erp/shared';

import { forbidden, notFound, unprocessable } from './errors';
import { permissionsOf } from './permissions';
import { type Authenticated } from './require-role';

/**
 * ADVICE & LEARNING (2026-10-22) -- what the staff library routes and the
 * public guide routes share. docs/DECISIONS.md, "Advice & Learning: draft,
 * review, publish".
 *
 * One table, learning_resource (migration 6, extended by 20261022100000). Two
 * presentations of it: the staff one carries the workflow (status, who moved
 * it, the review note); the PUBLIC one is a whitelist -- no storage path, no
 * staff ids or names, no status, no note -- and is only ever built from a
 * published row.
 */

type Db = { $queryRawUnsafe: <T>(sql: string, ...p: unknown[]) => Promise<T> };

export interface ResourceRow {
  id: string;
  title: string;
  title_ar: string | null;
  topic: string;
  topics: string[];
  crop: string | null;
  language: string;
  format: string;
  storage_path: string;
  byte_size: number;
  description: string | null;
  description_ar: string | null;
  published: boolean;
  status: LearningStatus;
  uploaded_at: Date;
  updated_at: Date;
  submitted_at: Date | null;
  /** An id, for the audit row only; never presented. */
  submitted_by: string | null;
  submitted_by_name: string | null;
  reviewed_at: Date | null;
  reviewed_by_name: string | null;
  review_note: string | null;
  published_at: Date | null;
  published_by_name: string | null;
}

/**
 * FROM the _active view (soft-deleted rows never appear) with the names of the
 * staff who moved it. Staff names are shown to staff only; the public
 * presentation below never reads them.
 */
export const RESOURCE_FROM = `FROM public.learning_resource_active r
  LEFT JOIN public."user" su ON su.id = r.submitted_by
  LEFT JOIN public."user" ru ON ru.id = r.reviewed_by
  LEFT JOIN public."user" pu ON pu.id = r.published_by`;

export const RESOURCE_COLUMNS = `r.id, r.title, r.title_ar, r.topic::text AS topic, r.topics,
  r.crop::text AS crop, r.language::text AS language, r.format::text AS format,
  r.storage_path, r.byte_size, r.description, r.description_ar, r.published,
  r.status::text AS status, r.uploaded_at, r.updated_at,
  r.submitted_at, r.submitted_by, su.name AS submitted_by_name,
  r.reviewed_at, ru.name AS reviewed_by_name, r.review_note,
  r.published_at, pu.name AS published_by_name`;

/** The staff card. `published` is still sent: older screens read it. */
export const presentResource = (row: ResourceRow) => ({
  id: row.id,
  title: row.title,
  title_ar: row.title_ar,
  topic: row.topic,
  topics: row.topics,
  crop: row.crop,
  language: row.language,
  format: row.format,
  storage_path: row.storage_path,
  byte_size: row.byte_size,
  description: row.description,
  description_ar: row.description_ar,
  published: row.published,
  status: row.status,
  uploaded_at: toIso(row.uploaded_at),
  updated_at: toIso(row.updated_at),
  submitted_at: row.submitted_at ? toIso(row.submitted_at) : null,
  submitted_by_name: row.submitted_by_name,
  reviewed_at: row.reviewed_at ? toIso(row.reviewed_at) : null,
  reviewed_by_name: row.reviewed_by_name,
  review_note: row.review_note,
  published_at: row.published_at ? toIso(row.published_at) : null,
  published_by_name: row.published_by_name,
});

/** One live resource by id, or the house 404. Out of scope and absent read the same (C-3.5). */
export async function loadResource(db: Db, id: string, lock = false): Promise<ResourceRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  if (lock) {
    // A move reads the state it moves from under a row lock, so two
    // publishers pressing at once cannot both move it.
    await db.$queryRawUnsafe(
      'SELECT id FROM public.learning_resource WHERE id = $1::uuid AND deleted_at IS NULL FOR UPDATE',
      id,
    );
  }
  const [row] = await db.$queryRawUnsafe<ResourceRow[]>(
    `SELECT ${RESOURCE_COLUMNS} ${RESOURCE_FROM} WHERE r.id = $1::uuid`,
    id,
  );
  if (!row) throw notFound();
  return row;
}

// ---------------------------------------------------------------------------
// PERMISSIONS: PUBLISHING AUTHORITY IS SEPARATELY ASSIGNABLE
// ---------------------------------------------------------------------------

export interface ContentAccess {
  /** content.moderate OR content.publish: write drafts, submit for review. */
  readonly write: boolean;
  /** content.publish: return, publish, unpublish; edit what is in review or public. */
  readonly publish: boolean;
}

/** What the caller may do with guides. Platform-wide: guides are not state data. */
export async function contentAccess(auth: Authenticated): Promise<ContentAccess> {
  const permissions = await permissionsOf(auth);
  const publish = holdsPermission(permissions, 'content.publish');
  return { publish, write: publish || holdsPermission(permissions, 'content.moderate') };
}

/** 403 unless the caller may write guides at all. */
export async function requireContentWriter(auth: Authenticated): Promise<ContentAccess> {
  const access = await contentAccess(auth);
  if (!access.write) throw forbidden();
  return access;
}

/**
 * A guide in review or public is changed only by someone who could publish it.
 * The caller may write (or the route would have refused already), so this is a
 * business rule about the guide's state -- a 422 that says what to do -- not a
 * 403 that says nothing.
 */
export function checkEditable(access: ContentAccess, status: LearningStatus): void {
  if (learningEditNeedsPublish(status) && !access.publish) {
    throw unprocessable('learning_resource_locked');
  }
}

// ---------------------------------------------------------------------------
// TOPICS: the shared advice topics, with the library's own shelf kept filled
// ---------------------------------------------------------------------------

/**
 * The `topics` and the old single `topic` a card is written with.
 *
 * - topics: as sent; else the advice topic of the `topic` sent; else (an edit
 *   that sent neither -- the schema refuses that on a create) unchanged.
 * - topic: as sent; else kept, when it still maps to the first advice topic
 *   (so a "Cooperatives" shelf is not rewritten as "Finance" for nothing);
 *   else derived from the first advice topic.
 */
export function topicsFor(
  body: Pick<LearningResourceInput, 'topic' | 'topics'>,
  current: Pick<ResourceRow, 'topic' | 'topics'> | null,
): { topics: AdviceTopic[]; topic: LearningTopic } {
  const topics: AdviceTopic[] =
    body.topics ??
    (body.topic
      ? [ADVICE_TOPIC_FOR_LEARNING_TOPIC[body.topic]]
      : ((current?.topics ?? ['other']) as AdviceTopic[]));
  const first = topics[0] ?? 'other';
  const kept =
    current && ADVICE_TOPIC_FOR_LEARNING_TOPIC[current.topic as LearningTopic] === first
      ? (current.topic as LearningTopic)
      : null;
  return { topics, topic: body.topic ?? kept ?? LEARNING_TOPIC_FOR_ADVICE_TOPIC[first] };
}

// ---------------------------------------------------------------------------
// THE PUBLIC GUIDE
// ---------------------------------------------------------------------------

export interface PublicGuideRow {
  id: string;
  title: string;
  title_ar: string | null;
  description: string | null;
  description_ar: string | null;
  topics: string[];
  crop: string | null;
  language: string;
  format: string;
  byte_size: number;
  published_on: Date;
}

/**
 * Published guides only, from the _active view. `published_on` is the last
 * publish time, or the upload time for a guide published before the workflow
 * recorded one (migration 20261022100000 does not invent a date).
 */
export const PUBLIC_GUIDE_COLUMNS = `id, title, title_ar, description, description_ar, topics,
  crop::text AS crop, language::text AS language, format::text AS format, byte_size,
  COALESCE(published_at, uploaded_at) AS published_on`;
export const PUBLIC_GUIDE_FROM = 'FROM public.learning_resource_active';
export const PUBLIC_GUIDE_WHERE = `status = 'published'`;

/** The whitelist. Nothing here names a member of staff or where the file is stored. */
export const presentGuide = (row: PublicGuideRow) => ({
  id: row.id,
  title: row.title,
  title_ar: row.title_ar,
  summary: row.description,
  summary_ar: row.description_ar,
  topics: row.topics,
  crop: row.crop,
  language: row.language,
  format: row.format,
  byte_size: row.byte_size,
  published_on: toIso(row.published_on),
});
