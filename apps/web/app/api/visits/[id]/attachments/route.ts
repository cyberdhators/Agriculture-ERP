import {
  ATTACHMENT_LIMITS,
  VISIT_ATTACHMENT_BUCKET,
  attachmentStoragePath,
  declareAttachmentSchema,
  toIso,
} from '@agri-erp/shared';
import { audited, writeAudit } from '../../../../../lib/api/audit';
import { conflict, forbidden } from '../../../../../lib/api/errors';
import { created, defineRoutes, ok } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import {
  ATTACHMENT_COLUMNS,
  type AttachmentRow,
  attachmentsOf,
  loadVisibleVisit,
  presentAttachment,
} from '../../../../../lib/api/visits';
import { prisma } from '../../../../../lib/db';
import { issueUploadGrant, removeStoredObject } from '../../../../../lib/supabase/admin';

/**
 * POST /api/visits/:id/attachments — the visit's officer declares an
 * attachment: the row, before the bytes (C-8.6). The size and type were judged
 * by the schema before this runs, so a file over the ceiling is refused before
 * any byte travels. The response carries an upload grant for this one object
 * path, expiring in minutes (C-8.8); the phone uploads straight to Storage and
 * then confirms.
 *
 * Declaring the same id again is how "send it again" works: a waiting or
 * failed attachment is re-declared and gets a fresh grant; an arrived one is
 * returned as it is, with no grant. The same id on another visit is a conflict.
 *
 * GET — the visit's attachments with their state and its sentence (C-8.7).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ auth, params }) => {
      const visit = await loadVisibleVisit(prisma, params.id ?? '', auth);
      const rows = await attachmentsOf(prisma, [visit.id]);
      return ok(rows.map(presentAttachment));
    },
  },
  POST: {
    roles: ['officer'],
    bodySchema: declareAttachmentSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const visit = await loadVisibleVisit(prisma, params.id ?? '', auth);
      if (visit.officer_id !== auth.principal.id) throw forbidden();

      const [existing] = await prisma.$queryRawUnsafe<AttachmentRow[]>(
        `SELECT ${ATTACHMENT_COLUMNS} FROM public.visit_attachment a WHERE a.id = $1::uuid`,
        body.id,
      );
      if (existing && existing.visit_id !== visit.id) throw conflict('attachment_already_exists');
      if (existing?.status === 'arrived') return ok(presentAttachment(existing));

      const path = attachmentStoragePath(visit.id, body.id, body.content_type);
      if (existing && existing.storage_path !== path) {
        // A re-declaration with a different type moves the path; whatever
        // half-arrived at the old one is not wanted. Best effort: nothing
        // depends on it succeeding.
        await removeStoredObject(VISIT_ATTACHMENT_BUCKET, existing.storage_path).catch(() => {});
      }

      const row = await audited(prisma, async (tx) => {
        const [saved] = await tx.$queryRawUnsafe<AttachmentRow[]>(
          `WITH a AS (
             INSERT INTO public.visit_attachment
               (id, visit_id, kind, storage_path, content_type, byte_size, captured_at, grant_expires_at, created_by)
             VALUES ($1::uuid, $2::uuid, $3::public.attachment_kind, $4, $5, $6, $7::timestamptz,
                     now() + ($8::int * interval '1 minute'), $9::uuid)
             ON CONFLICT (id) DO UPDATE SET
               kind = EXCLUDED.kind, storage_path = EXCLUDED.storage_path,
               content_type = EXCLUDED.content_type, byte_size = EXCLUDED.byte_size,
               captured_at = EXCLUDED.captured_at, grant_expires_at = EXCLUDED.grant_expires_at,
               status = 'waiting', arrived_at = NULL, failed_at = NULL, failure_code = NULL,
               updated_at = now()
             WHERE public.visit_attachment.status <> 'arrived'
             RETURNING *
           )
           SELECT ${ATTACHMENT_COLUMNS} FROM a`,
          body.id,
          visit.id,
          body.kind,
          path,
          body.content_type,
          body.byte_size,
          body.captured_at,
          ATTACHMENT_LIMITS.grantMinutes,
          auth.principal.id,
        );
        if (!saved) throw new Error('attachment declaration returned no row');
        await writeAudit(tx, {
          entityType: 'visit',
          entityId: visit.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'visit.attachment_declared',
          before: existing ? { attachment_id: existing.id, status: existing.status } : null,
          after: {
            attachment_id: saved.id,
            kind: saved.kind,
            content_type: saved.content_type,
            byte_size: saved.byte_size,
            status: saved.status,
          },
        });
        return saved;
      });

      // The grant is issued after the row is committed: a grant with no row
      // would be a path nobody owns. If this call fails the row stays waiting
      // and the phone's next declaration issues a new one.
      const grant = await issueUploadGrant(VISIT_ATTACHMENT_BUCKET, path);
      const presented = {
        ...presentAttachment(row),
        upload: { url: grant.url, token: grant.token, expires_at: toIso(row.grant_expires_at) },
      };
      return existing ? ok(presented) : created(presented);
    },
  },
});
