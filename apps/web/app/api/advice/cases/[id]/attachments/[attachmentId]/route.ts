import { ADVICE_ATTACHMENT_BUCKET, BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import { loadCase, presentCase } from '../../../../../../../lib/api/advice';
import { audited, writeAudit } from '../../../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../../../lib/api/errors';
import { checkId } from '../../../../../../../lib/api/market-posts';
import { actorOf, me } from '../../../../../../../lib/api/messaging';
import { defineRoutes, ok } from '../../../../../../../lib/api/route';
import { prisma } from '../../../../../../../lib/db';
import { removeStoredObject } from '../../../../../../../lib/supabase/admin';

/**
 * DELETE /api/advice/cases/:id/attachments/:attachmentId -- the person who
 * added a photo takes it back (2026-10-25), open case or closed. The other
 * participant cannot (`advice_attachment_not_yours`); anyone else gets 404.
 *
 * The row is never deleted: it is soft-deleted (deleted_at) and audited as
 * `advice_attachment.removed` with the case id only. The stored object is then
 * removed, best effort -- once soft-deleted it is shown to nobody, and a
 * question's photo should not outlive the asker's wish to take it back. A copy
 * shared with a referred provider is its own object and its own row, removed
 * from that case by the same person.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  DELETE: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params }) => {
      const reader = me(auth);
      const id = checkId(params.id);
      const attachmentId = checkId(params.attachmentId);
      const removed = await audited(prisma, async (tx) => {
        const current = await loadCase(tx, id, reader, true);
        const [found] = await tx.$queryRawUnsafe<
          { id: string; uploaded_by: string; storage_path: string }[]
        >(
          `SELECT id, uploaded_by, storage_path FROM public.advice_case_attachment
            WHERE id = $1::uuid AND case_id = $2::uuid AND deleted_at IS NULL
            FOR UPDATE`,
          attachmentId,
          current.id,
        );
        if (!found) throw notFound();
        if (found.uploaded_by !== reader) throw unprocessable('advice_attachment_not_yours');
        await tx.$executeRawUnsafe(
          `UPDATE public.advice_case_attachment SET deleted_at = now() WHERE id = $1::uuid`,
          found.id,
        );
        await writeAudit(tx, {
          entityType: 'advice_case_attachment',
          entityId: found.id,
          ...actorOf(auth),
          action: 'advice_attachment.removed',
          before: { removed: false },
          after: { removed: true, case_id: current.id },
        });
        return found.storage_path;
      });
      await removeStoredObject(ADVICE_ATTACHMENT_BUCKET, removed).catch(() => {});
      const row = await loadCase(prisma, id, reader);
      return ok(await presentCase(prisma, row, reader, true));
    },
  },
});
