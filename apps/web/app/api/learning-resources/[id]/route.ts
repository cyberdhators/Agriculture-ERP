import { LEARNING_RESOURCE_BUCKET, learningResourceInputSchema, toIso } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../lib/api/errors';
import { defineRoutes, empty, ok } from '../../../../lib/api/route';
import { requireWriter } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';
import { describeStoredObject } from '../../../../lib/supabase/admin';

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

      /*
       * THE FILE DOES NOT MOVE. `storage_path` was derived from this row's id
       * when it was created and is not in the edit schema, so a correction to
       * the card can never repoint it at another object. Replacing the file
       * means registering a new resource.
       *
       * PUBLISHING IS WHERE THE FILE IS CHECKED. The column's own comment sets
       * the rule -- "a half-uploaded file is never offered to an officer" -- so
       * a false->true publish asks the provider what is actually at the path
       * and refuses if nothing is there, or if what is there is not the size
       * this card claims. An officer's tap then reaches a file that exists.
       */
      if (!target.published && body.published) {
        const stored = await describeStoredObject(LEARNING_RESOURCE_BUCKET, target.storage_path);
        if (!stored) throw unprocessable('resource_file_missing');
        if (stored.byteSize !== null && stored.byteSize !== body.byte_size) {
          throw unprocessable('resource_file_mismatch');
        }
      }

      const row = await audited(prisma, async (tx) => {
        const [updated] = await tx.$queryRawUnsafe<ResourceRow[]>(
          `UPDATE public.learning_resource
           SET title = $2, topic = $3::public.learning_topic, crop = $4::public.crop,
               language = $5::public.language, format = $6::public.resource_format,
               byte_size = $7, description = $8, published = $9
           WHERE id = $1::uuid AND deleted_at IS NULL
           RETURNING ${SELECT_COLUMNS}`,
          target.id,
          body.title,
          body.topic,
          body.crop ?? null,
          body.language,
          body.format,
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
