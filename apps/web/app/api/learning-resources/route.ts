import { randomUUID } from 'node:crypto';

import {
  DEFAULT_LIMIT,
  LEARNING_LIMITS,
  LEARNING_RESOURCE_BUCKET,
  MAX_LIMIT,
  createLearningResourceSchema,
  decodeCursor,
  encodeCursor,
  learningStoragePath,
  toIso,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../lib/api/audit';
import { invalidCursor } from '../../../lib/api/errors';
import { created, defineRoutes, paged } from '../../../lib/api/route';
import { requireWriter } from '../../../lib/api/scope';
import { prisma } from '../../../lib/db';
import { issueUploadGrant } from '../../../lib/supabase/admin';

/**
 * The learning resource centre (C-13.6 to C-13.9), deliverable (m). Unit P1.
 *
 * A catalogue of files that live in a PRIVATE Supabase Storage bucket. The
 * card is registered first and the server answers with a grant to upload the
 * file to the one path it derived; the card carries -- title, topic, the
 * storage_path and byte_size the download needs. There is no upload endpoint
 * here, on purpose.
 *
 * READ SCOPE: every role may read the library; it is not state data. A
 * non-administrator sees published cards only, so a half-prepared resource is
 * never offered to an officer (migration 6).
 *
 * SORT: uploaded_at descending, id descending as tiebreak, exactly as the
 * officer and user lists sort by created_at.
 *
 * WRITES are administrator-only.
 */

interface ResourceRow {
  id: string;
  title: string;
  topic: string;
  crop: string | null;
  language: string;
  format: string;
  storage_path: string;
  byte_size: number;
  description: string | null;
  published: boolean;
  uploaded_at: Date;
}

const present = (row: ResourceRow) => ({
  id: row.id,
  title: row.title,
  topic: row.topic,
  crop: row.crop,
  language: row.language,
  format: row.format,
  storage_path: row.storage_path,
  byte_size: row.byte_size,
  description: row.description,
  published: row.published,
  uploaded_at: toIso(row.uploaded_at),
});

const SELECT_COLUMNS = `id, title, topic::text AS topic, crop::text AS crop,
  language::text AS language, format::text AS format, storage_path, byte_size,
  description, published, uploaded_at`;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ request, auth }) => {
      const url = new URL(request.url);
      const rawLimit = url.searchParams.get('limit');
      const rawCursor = url.searchParams.get('cursor');

      let limit = DEFAULT_LIMIT;
      if (rawLimit !== null) {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1) throw invalidCursor();
        limit = Math.min(parsed, MAX_LIMIT);
      }

      const where: string[] = [];
      const params: unknown[] = [];

      // A non-administrator sees published resources only. The constraint is
      // the role, not a filter the caller chose.
      if (auth.scope.kind !== 'all') {
        where.push('published = true');
      }

      // Optional filters. Enum values are compared as text so an unknown value
      // returns nothing rather than failing the enum cast with a 500.
      const topic = url.searchParams.get('topic');
      if (topic !== null) {
        params.push(topic);
        where.push(`topic::text = $${params.length}`);
      }
      const crop = url.searchParams.get('crop');
      if (crop !== null) {
        params.push(crop);
        where.push(`crop::text = $${params.length}`);
      }
      const language = url.searchParams.get('language');
      if (language !== null) {
        params.push(language);
        where.push(`language::text = $${params.length}`);
      }

      if (rawCursor !== null) {
        const cursor = decodeCursor(rawCursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(uploaded_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<ResourceRow[]>(
        `SELECT ${SELECT_COLUMNS}
         FROM public.learning_resource_active
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY uploaded_at DESC, id DESC
         LIMIT ${limit + 1}`,
        ...params,
      );

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];

      return paged(page.map(present), {
        cursor:
          hasMore && last
            ? encodeCursor({ createdAt: toIso(last.uploaded_at), id: last.id })
            : null,
        hasMore,
      });
    },
  },

  /**
   * POST — registers a resource and hands back a grant to upload its file.
   *
   * THE PATH IS THE SERVER'S. The id is minted here and the object path is
   * derived from it (`learningStoragePath`), so one catalogue row addresses
   * exactly one object. The caller says what KIND of file is coming; it never
   * says where the file goes, and there is no longer a `storage_path` field
   * for it to say it in.
   *
   * THE ROW IS BORN UNPUBLISHED, whatever was asked for. The bytes have not
   * arrived yet, and the column's own comment is the rule: "New rows start
   * unpublished so a half-uploaded file is never offered to an officer."
   * Publishing is a second, deliberate PATCH, and that is where the file is
   * checked to exist.
   */
  POST: {
    roles: ['admin'],
    bodySchema: createLearningResourceSchema,
    handler: async ({ auth, body }) => {
      requireWriter(auth);

      const id = randomUUID();
      const storagePath = learningStoragePath(id, body.content_type);

      const row = await audited(prisma, async (tx) => {
        const [inserted] = await tx.$queryRawUnsafe<ResourceRow[]>(
          `INSERT INTO public.learning_resource
             (id, title, topic, crop, language, format, storage_path, byte_size, description,
              published, uploaded_by)
           VALUES ($1::uuid, $2, $3::public.learning_topic, $4::public.crop, $5::public.language,
                   $6::public.resource_format, $7, $8, $9, false, $10::uuid)
           RETURNING ${SELECT_COLUMNS}`,
          id,
          body.title,
          body.topic,
          body.crop ?? null,
          body.language,
          body.format,
          storagePath,
          body.byte_size,
          body.description ?? null,
          auth.principal.id,
        );
        const createdRow = inserted as ResourceRow;
        await writeAudit(tx, {
          entityType: 'learning_resource',
          entityId: createdRow.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'learning_resource.created',
          after: {
            title: createdRow.title,
            topic: createdRow.topic,
            language: createdRow.language,
            format: createdRow.format,
            published: createdRow.published,
          },
        });
        return createdRow;
      });

      // The grant is issued after the row is committed: a grant with no row
      // would be a path nobody owns. It is for this one object path only.
      const grant = await issueUploadGrant(LEARNING_RESOURCE_BUCKET, row.storage_path);
      return created({
        ...present(row),
        upload: {
          url: grant.url,
          token: grant.token,
          expires_in_minutes: LEARNING_LIMITS.grantMinutes,
        },
      });
    },
  },
});
