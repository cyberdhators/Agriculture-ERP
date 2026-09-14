import { learningResourceInputSchema, toIso } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { conflict, notFound } from '../../../../lib/api/errors';
import { defineRoutes, empty, ok } from '../../../../lib/api/route';
import { requireWriter } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * A single learning resource (C-13.6 to C-13.9). Unit P1. Writes are
 * administrator-only. A PATCH that flips published from false to true is its
 * own `learning_resource.published` audit row, so "who published this" is
 * answerable without diffing JSON.
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

/**
 * Loads a resource, or 404. Reads learning_resource_active, so a soft-deleted
 * row is invisible; the administrative `published` flag is not a filter here --
 * an administrator edits unpublished cards. Out of scope and does-not-exist are
 * the same response (C-3.5).
 */
async function loadVisible(id: string): Promise<ResourceRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const [row] = await prisma.$queryRawUnsafe<ResourceRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM public.learning_resource_active WHERE id = $1::uuid`,
    id,
  );
  if (!row) throw notFound();
  return row;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: ['admin'],
    bodySchema: learningResourceInputSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const target = await loadVisible(params.id ?? '');

      // Registering the card against a different file must respect the one
      // live resource per file rule, but the card keeping its own path is not a
      // clash with itself.
      if (body.storage_path !== target.storage_path) {
        const [clash] = await prisma.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM public.learning_resource_active WHERE storage_path = $1 AND id <> $2::uuid',
          body.storage_path,
          target.id,
        );
        if (clash) throw conflict('resource_file_already_registered');
      }

      const row = await audited(prisma, async (tx) => {
        const [updated] = await tx.$queryRawUnsafe<ResourceRow[]>(
          `UPDATE public.learning_resource
           SET title = $2, topic = $3::public.learning_topic, crop = $4::public.crop,
               language = $5::public.language, format = $6::public.resource_format,
               storage_path = $7, byte_size = $8, description = $9, published = $10
           WHERE id = $1::uuid AND deleted_at IS NULL
           RETURNING ${SELECT_COLUMNS}`,
          target.id,
          body.title,
          body.topic,
          body.crop ?? null,
          body.language,
          body.format,
          body.storage_path,
          body.byte_size,
          body.description ?? null,
          body.published,
        );
        if (!updated) throw notFound();
        const next = updated as ResourceRow;

        const actor = { actorType: auth.role, actorId: auth.principal.id } as const;

        // A false->true publish is its own row and is left out of the edit
        // diff. Unpublishing (true->false) is an ordinary edit and stays in it.
        const publishing = !target.published && next.published;

        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const [key, was, now] of [
          ['title', target.title, next.title],
          ['topic', target.topic, next.topic],
          ['crop', target.crop, next.crop],
          ['language', target.language, next.language],
          ['format', target.format, next.format],
          ['storage_path', target.storage_path, next.storage_path],
          ['byte_size', target.byte_size, next.byte_size],
          ['description', target.description, next.description],
        ] as const) {
          if (was !== now) {
            before[key] = was;
            after[key] = now;
          }
        }
        if (!publishing && target.published !== next.published) {
          before.published = target.published;
          after.published = next.published;
        }
        if (Object.keys(after).length > 0) {
          await writeAudit(tx, {
            entityType: 'learning_resource',
            entityId: next.id,
            ...actor,
            action: 'learning_resource.updated',
            before,
            after,
          });
        }
        if (publishing) {
          await writeAudit(tx, {
            entityType: 'learning_resource',
            entityId: next.id,
            ...actor,
            action: 'learning_resource.published',
            before: { published: false },
            after: { published: true },
          });
        }
        return next;
      });

      return ok(present(row));
    },
  },

  DELETE: {
    roles: ['admin'],
    handler: async ({ auth, params }) => {
      requireWriter(auth);
      const target = await loadVisible(params.id ?? '');

      await audited(prisma, async (tx) => {
        const [row] = await tx.$queryRawUnsafe<{ deleted_at: Date }[]>(
          `UPDATE public.learning_resource SET deleted_at = now(), deleted_by = $2::uuid
           WHERE id = $1::uuid AND deleted_at IS NULL RETURNING deleted_at`,
          target.id,
          auth.principal.id,
        );
        if (!row) throw notFound();
        await writeAudit(tx, {
          entityType: 'learning_resource',
          entityId: target.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'learning_resource.soft_deleted',
          before: { deleted_at: null },
          after: { deleted_at: toIso(row.deleted_at) },
        });
      });

      return empty(204);
    },
  },
});
