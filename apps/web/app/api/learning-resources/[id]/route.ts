import { learningResourceInputSchema, toIso } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { conflict, notFound } from '../../../../lib/api/errors';
import {
  checkEditable,
  loadResource,
  presentResource,
  requireContentWriter,
  topicsFor,
} from '../../../../lib/api/learning';
import { defineRoutes, empty, ok } from '../../../../lib/api/route';
import { requireWriter } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * A single learning resource (C-13.6 to C-13.9). Unit P1.
 *
 * 2026-10-22, Advice & Learning: the card no longer carries `published`. A
 * guide moves draft -> in review -> published -> unpublished only through
 * POST /:id/transition, each move its own audit row. Editing is for an
 * administrator holding "Moderate content and listings" or "Publish content";
 * a guide in review or public may be edited only by someone who can publish
 * (`learning_resource_locked`), so nobody changes public text that nobody with
 * the authority approved. Removing follows the same rule.
 */

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: ['admin'],
    bodySchema: learningResourceInputSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const access = await requireContentWriter(auth);
      const target = await loadResource(prisma, params.id ?? '');
      checkEditable(access, target.status);

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

      const { topics, topic } = topicsFor(body, target);

      const row = await audited(prisma, async (tx) => {
        // The state is re-read under the lock: a guide submitted or published
        // between the read above and this write is judged as it now stands.
        const current = await loadResource(tx, target.id, true);
        checkEditable(access, current.status);
        const updated = await tx.$queryRawUnsafe<{ id: string }[]>(
          `UPDATE public.learning_resource
           SET title = $2, topic = $3::public.learning_topic, topics = $4::text[],
               crop = $5::public.crop, language = $6::public.language,
               format = $7::public.resource_format, storage_path = $8, byte_size = $9,
               description = $10, title_ar = $11, description_ar = $12, updated_at = now()
           WHERE id = $1::uuid AND deleted_at IS NULL
           RETURNING id`,
          current.id,
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
        );
        if (updated.length === 0) throw notFound();
        const next = await loadResource(tx, current.id);

        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const [key, was, now] of [
          ['title', current.title, next.title],
          ['title_ar', current.title_ar, next.title_ar],
          ['topic', current.topic, next.topic],
          ['crop', current.crop, next.crop],
          ['language', current.language, next.language],
          ['format', current.format, next.format],
          ['storage_path', current.storage_path, next.storage_path],
          ['byte_size', current.byte_size, next.byte_size],
          ['description', current.description, next.description],
          ['description_ar', current.description_ar, next.description_ar],
        ] as const) {
          if (was !== now) {
            before[key] = was;
            after[key] = now;
          }
        }
        if (!sameList(current.topics, next.topics)) {
          before.topics = current.topics;
          after.topics = next.topics;
        }
        if (Object.keys(after).length > 0) {
          await writeAudit(tx, {
            entityType: 'learning_resource',
            entityId: next.id,
            actorType: auth.role,
            actorId: auth.principal.id,
            action: 'learning_resource.updated',
            // The status is context, not a change: it says whether this edit
            // reached public text.
            before: { ...before, status: current.status },
            after: { ...after, status: next.status },
          });
        }
        return next;
      });

      return ok(presentResource(row));
    },
  },

  DELETE: {
    roles: ['admin'],
    handler: async ({ auth, params }) => {
      requireWriter(auth);
      const access = await requireContentWriter(auth);
      const target = await loadResource(prisma, params.id ?? '');
      // Removing a public guide takes it off the public pages, which is
      // publishing authority's call, as unpublishing is.
      checkEditable(access, target.status);

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
          before: { deleted_at: null, status: target.status },
          after: { deleted_at: toIso(row.deleted_at) },
        });
      });

      return empty(204);
    },
  },
});
