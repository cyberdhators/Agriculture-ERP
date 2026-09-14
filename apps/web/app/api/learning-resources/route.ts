import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  decodeCursor,
  encodeCursor,
  learningResourceInputSchema,
  toIso,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../lib/api/audit';
import { conflict, invalidCursor } from '../../../lib/api/errors';
import { created, defineRoutes, paged } from '../../../lib/api/route';
import { requireWriter } from '../../../lib/api/scope';
import { prisma } from '../../../lib/db';

/**
 * The learning resource centre (C-13.6 to C-13.9), deliverable (m). Unit P1.
 *
 * A catalogue of files that live in Supabase Storage: the file is uploaded by
 * the client first, and this registers the card -- title, topic, the
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

  POST: {
    roles: ['admin'],
    bodySchema: learningResourceInputSchema,
    handler: async ({ auth, body }) => {
      requireWriter(auth);

      // One live resource per stored file (migration 6's partial unique index).
      // Checking first turns the index violation into a 409 the caller can act
      // on rather than a 500.
      const [clash] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        'SELECT id FROM public.learning_resource_active WHERE storage_path = $1',
        body.storage_path,
      );
      if (clash) throw conflict('resource_file_already_registered');

      const row = await audited(prisma, async (tx) => {
        const [inserted] = await tx.$queryRawUnsafe<ResourceRow[]>(
          `INSERT INTO public.learning_resource
             (title, topic, crop, language, format, storage_path, byte_size, description,
              published, uploaded_by)
           VALUES ($1, $2::public.learning_topic, $3::public.crop, $4::public.language,
                   $5::public.resource_format, $6, $7, $8, $9, $10::uuid)
           RETURNING ${SELECT_COLUMNS}`,
          body.title,
          body.topic,
          body.crop ?? null,
          body.language,
          body.format,
          body.storage_path,
          body.byte_size,
          body.description ?? null,
          body.published,
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

      return created(present(row));
    },
  },
});
