import { remainingDeliveries } from '@agri-erp/shared';

import {
  deliveryCounts,
  idParam,
  loadAnnouncement,
  presentAnnouncement,
} from '../../../../../../lib/api/announcements';
import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../../lib/api/errors';
import { requirePermission } from '../../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { requireWriter } from '../../../../../../lib/api/scope';
import { prisma } from '../../../../../../lib/db';

/**
 * POST /api/admin/announcements/:id/retry (2026-10-27). ADMINISTRATOR ONLY,
 * then `communications.send`.
 *
 * Puts every FAILED delivery of a sent announcement back in the queue and
 * the announcement back to `sending`; the screen then processes it as
 * before. A failure is never retried automatically -- an interrupted SMS may
 * have gone, and a second one would be billed -- so this is a person's
 * decision, and it is audited with the count.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor'],
    handler: async ({ auth, params }) => {
      requireWriter(auth);
      await requirePermission(auth, 'communications.send');
      const id = idParam(params);

      const row = await audited(prisma, async (tx) => {
        const before = await loadAnnouncement(id, tx, true);
        if (!before) throw notFound();
        if (before.status === 'draft') throw unprocessable('announcement_not_sending');
        const requeued = await tx.$executeRawUnsafe(
          `UPDATE public.announcement_delivery
              SET status = 'queued', error = NULL, claimed_at = NULL, updated_at = now()
            WHERE announcement_id = $1::uuid AND status = 'failed'`,
          id,
        );
        if (requeued === 0) throw unprocessable('announcement_nothing_to_retry');
        await tx.$executeRawUnsafe(
          `UPDATE public.announcement
              SET status = 'sending', completed_at = NULL, updated_at = now()
            WHERE id = $1::uuid`,
          id,
        );
        await writeAudit(tx, {
          entityType: 'announcement',
          entityId: id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'announcement.retry_queued',
          before: { status: before.status },
          after: { status: 'sending', requeued },
        });
        return (await loadAnnouncement(id, tx)) ?? before;
      });

      const counts = await deliveryCounts(id);
      return ok({
        announcement: presentAnnouncement(row),
        deliveries: counts,
        remaining: remainingDeliveries(counts),
      });
    },
  },
});
