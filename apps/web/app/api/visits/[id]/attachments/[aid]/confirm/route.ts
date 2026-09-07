import {
  VISIT_ATTACHMENT_BUCKET,
  type AttachmentFailureCode,
  emptyBodySchema,
} from '@agri-erp/shared';
import { audited, writeAudit } from '../../../../../../../lib/api/audit';
import {
  type RuleKey,
  conflict,
  forbidden,
  unprocessable,
} from '../../../../../../../lib/api/errors';
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
import { describeStoredObject, removeStoredObject } from '../../../../../../../lib/supabase/admin';

/**
 * POST /api/visits/:id/attachments/:aid/confirm — the phone says the bytes are
 * up; the server checks (C-8.8, owner's condition): the object EXISTS and
 * matches the declared size and type, within our grant window. A mismatch or
 * a late arrival removes the object and fails the row with a code, so a grant
 * is never a grant to store anything. An arrived attachment confirms again
 * harmlessly (B9's retry); a failed one is told to send again.
 */
async function settle(
  visitId: string,
  attachmentId: string,
  auth: { role: 'officer'; id: string },
  outcome: { status: 'arrived' } | { status: 'failed'; code: AttachmentFailureCode },
): Promise<AttachmentRow> {
  return audited(prisma, async (tx) => {
    const [row] = await tx.$queryRawUnsafe<AttachmentRow[]>(
      outcome.status === 'arrived'
        ? `WITH a AS (UPDATE public.visit_attachment SET status = 'arrived', arrived_at = now(), updated_at = now()
             WHERE id = $1::uuid AND status = 'waiting' RETURNING *) SELECT ${ATTACHMENT_COLUMNS} FROM a`
        : `WITH a AS (UPDATE public.visit_attachment SET status = 'failed', failed_at = now(), failure_code = $2, updated_at = now()
             WHERE id = $1::uuid AND status = 'waiting' RETURNING *) SELECT ${ATTACHMENT_COLUMNS} FROM a`,
      ...(outcome.status === 'arrived' ? [attachmentId] : [attachmentId, outcome.code]),
    );
    if (!row) throw conflict('attachment_already_failed');
    await writeAudit(tx, {
      entityType: 'visit',
      entityId: visitId,
      actorType: auth.role,
      actorId: auth.id,
      action: outcome.status === 'arrived' ? 'visit.attachment_arrived' : 'visit.attachment_failed',
      before: { attachment_id: attachmentId, status: 'waiting' },
      after: {
        attachment_id: attachmentId,
        status: row.status,
        ...(row.failure_code ? { failure_code: row.failure_code } : {}),
      },
    });
    return row;
  });
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['officer'],
    bodySchema: emptyBodySchema,
    handler: async ({ auth, params }) => {
      requireWriter(auth);
      const visit = await loadVisibleVisit(prisma, params.id ?? '', auth);
      if (visit.officer_id !== auth.principal.id) throw forbidden();
      const attachment = await loadAttachment(prisma, visit.id, params.aid ?? '');
      if (attachment.status === 'arrived') return ok(presentAttachment(attachment));
      if (attachment.status === 'failed') throw conflict('attachment_already_failed');

      const actor = { role: 'officer' as const, id: auth.principal.id };
      const stored = await describeStoredObject(VISIT_ATTACHMENT_BUCKET, attachment.storage_path);

      const fail = async (code: AttachmentFailureCode, rule: RuleKey): Promise<never> => {
        if (stored) await removeStoredObject(VISIT_ATTACHMENT_BUCKET, attachment.storage_path);
        await settle(visit.id, attachment.id, actor, { status: 'failed', code });
        throw unprocessable(rule);
      };

      if (Date.now() > attachment.grant_expires_at.getTime()) {
        return fail('grant_expired', 'attachment_grant_expired');
      }
      if (!stored) throw conflict('attachment_not_arrived');
      if (stored.byteSize !== attachment.byte_size)
        return fail('size_mismatch', 'attachment_mismatch');
      if (
        (stored.contentType ?? '').toLowerCase().split(';')[0]?.trim() !== attachment.content_type
      ) {
        return fail('type_mismatch', 'attachment_mismatch');
      }
      const row = await settle(visit.id, attachment.id, actor, { status: 'arrived' });
      return ok(presentAttachment(row));
    },
  },
});
