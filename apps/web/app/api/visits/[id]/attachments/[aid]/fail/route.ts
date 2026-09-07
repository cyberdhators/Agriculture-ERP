import { emptyBodySchema } from '@agri-erp/shared';
import { audited, writeAudit } from '../../../../../../../lib/api/audit';
import { forbidden } from '../../../../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../../../../lib/api/route';
import { requireWriter } from '../../../../../../../lib/api/scope';
import {
  ATTACHMENT_COLUMNS,
  type AttachmentRow,
  loadAttachment,
  loadVisibleVisit,
  presentAttachment,
} from '../../../../../../../lib/api/visits';
import { prisma } from '../../../../../../../lib/db';

/**
 * POST /api/visits/:id/attachments/:aid/fail — the phone gave up on a waiting
 * attachment (the file is gone from the device, say) and says so, so that
 * everyone entitled to the visit reads "did not send" rather than "waiting"
 * forever (C-8.7). A settled attachment is returned unchanged.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['officer'],
    bodySchema: emptyBodySchema,
    handler: async ({ auth, params }) => {
      requireWriter(auth);
      const visit = await loadVisibleVisit(prisma, params.id ?? '', auth);
      if (visit.officer_id !== auth.principal.id) throw forbidden();
      const attachment = await loadAttachment(prisma, visit.id, params.aid ?? '');
      if (attachment.status !== 'waiting') return ok(presentAttachment(attachment));
      const row = await audited(prisma, async (tx) => {
        const [updated] = await tx.$queryRawUnsafe<AttachmentRow[]>(
          `WITH a AS (UPDATE public.visit_attachment
             SET status = 'failed', failed_at = now(), failure_code = 'device_gave_up', updated_at = now()
             WHERE id = $1::uuid AND status = 'waiting' RETURNING *) SELECT ${ATTACHMENT_COLUMNS} FROM a`,
          attachment.id,
        );
        if (!updated) return attachment;
        await writeAudit(tx, {
          entityType: 'visit',
          entityId: visit.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'visit.attachment_failed',
          before: { attachment_id: attachment.id, status: 'waiting' },
          after: { attachment_id: attachment.id, status: 'failed', failure_code: 'device_gave_up' },
        });
        return updated;
      });
      return ok(presentAttachment(row));
    },
  },
});
