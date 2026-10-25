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
import {
  RESOURCE_COLUMNS,
  RESOURCE_FROM,
  contentAccess,
  loadResource,
  presentResource,
  requireContentWriter,
  topicsFor,
  type ResourceRow,
} from '../../../lib/api/learning';
import { created, defineRoutes, paged } from '../../../lib/api/route';
import { requireWriter } from '../../../lib/api/scope';
import { prisma } from '../../../lib/db';

/**
 * The learning resource centre (C-13.6 to C-13.9), deliverable (m). Unit P1.
 * 2026-10-22: Advice & Learning's draft -> review -> publish workflow on the
 * same table (lib/api/learning.ts; the moves are /:id/transition).
 *
 * A catalogue of files that live in Supabase Storage: the file is uploaded by
 * the client first, and this registers the card -- title, topics, the
 * storage_path and byte_size the download needs. There is no upload endpoint
 * here, on purpose.
 *
 * READ SCOPE: every role may read the library; it is not state data. A
 * non-administrator sees published cards only, so a draft is never offered to
 * an officer (migration 6). The public reads published guides through
 * /api/guides, which presents far less.
 *
 * SORT: uploaded_at descending, id descending as tiebreak, exactly as the
 * officer and user lists sort by created_at.
 *
 * WRITES: an administrator holding "Moderate content and listings" or
 * "Publish content" (2026-10-22). A new card is always a DRAFT: going public
 * is the publish move, which needs publishing authority.
 */
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

      // Only someone who may write guides (content.moderate or content.publish,
      // through a preset) sees drafts and guides in review; everyone else sees
      // published resources only. The constraint is the caller's permission,
      // not a filter they chose (2026-10-30: before, the role `admin`). `status`
      // and the old `published` flag cannot disagree (a CHECK, migration
      // 20261022100000).
      if (!(await contentAccess(auth)).write) {
        where.push(`r.status = 'published'`);
      }

      // Optional filters. Enum values are compared as text so an unknown value
      // returns nothing rather than failing the enum cast with a 500.
      const topic = url.searchParams.get('topic');
      if (topic !== null) {
        params.push(topic);
        where.push(`r.topic::text = $${params.length}`);
      }
      // 2026-10-22: one of the shared advice topics.
      const adviceTopic = url.searchParams.get('advice_topic');
      if (adviceTopic !== null) {
        params.push(adviceTopic);
        where.push(`$${params.length} = ANY(r.topics)`);
      }
      const status = url.searchParams.get('status');
      if (status !== null) {
        params.push(status);
        where.push(`r.status::text = $${params.length}`);
      }
      const crop = url.searchParams.get('crop');
      if (crop !== null) {
        params.push(crop);
        where.push(`r.crop::text = $${params.length}`);
      }
      const language = url.searchParams.get('language');
      if (language !== null) {
        params.push(language);
        where.push(`r.language::text = $${params.length}`);
      }

      if (rawCursor !== null) {
        const cursor = decodeCursor(rawCursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(r.uploaded_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<ResourceRow[]>(
        `SELECT ${RESOURCE_COLUMNS}
         ${RESOURCE_FROM}
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY r.uploaded_at DESC, r.id DESC
         LIMIT ${limit + 1}`,
        ...params,
      );

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];

      return paged(page.map(presentResource), {
        cursor:
          hasMore && last
            ? encodeCursor({ createdAt: toIso(last.uploaded_at), id: last.id })
            : null,
        hasMore,
      });
    },
  },

  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: learningResourceInputSchema,
    handler: async ({ auth, body }) => {
      requireWriter(auth);
      await requireContentWriter(auth);

      // One live resource per stored file (migration 6's partial unique index).
      // Checking first turns the index violation into a 409 the caller can act
      // on rather than a 500.
      const [clash] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        'SELECT id FROM public.learning_resource_active WHERE storage_path = $1',
        body.storage_path,
      );
      if (clash) throw conflict('resource_file_already_registered');

      const { topics, topic } = topicsFor(body, null);

      const row = await audited(prisma, async (tx) => {
        const [inserted] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.learning_resource
             (title, topic, topics, crop, language, format, storage_path, byte_size, description,
              title_ar, description_ar, status, published, uploaded_by)
           VALUES ($1, $2::public.learning_topic, $3::text[], $4::public.crop, $5::public.language,
                   $6::public.resource_format, $7, $8, $9, $10, $11, 'draft', false, $12::uuid)
           RETURNING id`,
          body.title,
          topic,
          topics,
          body.crop ?? null,
          body.language,
          body.format,
          body.storage_path,
          body.byte_size,
          body.description ?? null,
          body.title_ar ?? null,
          body.description_ar ?? null,
          auth.principal.id,
        );
        const createdRow = await loadResource(tx, (inserted as { id: string }).id);
        await writeAudit(tx, {
          entityType: 'learning_resource',
          entityId: createdRow.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'learning_resource.created',
          after: {
            title: createdRow.title,
            title_ar: createdRow.title_ar,
            topics: createdRow.topics,
            language: createdRow.language,
            format: createdRow.format,
            status: createdRow.status,
          },
        });
        return createdRow;
      });

      return created(presentResource(row));
    },
  },
});
