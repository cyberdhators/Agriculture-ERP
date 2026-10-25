import {
  announcementSendSchema,
  remainingDeliveries,
  type AnnouncementScope,
  type AnnouncementSendInput,
} from '@agri-erp/shared';

import {
  deliveryCounts,
  idParam,
  loadAnnouncement,
  planSummary,
  presentAnnouncement,
  queueDeliveries,
} from '../../../../../../lib/api/announcements';
import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { conflict, notFound, unprocessable } from '../../../../../../lib/api/errors';
import { requirePermission } from '../../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { requireWriter } from '../../../../../../lib/api/scope';
import { prisma } from '../../../../../../lib/db';

/**
 * POST /api/admin/announcements/:id/send { confirm: true, expected_recipients }
 * (2026-10-27). ADMINISTRATOR ONLY, then `communications.send`.
 *
 * QUEUES, IT DOES NOT DELIVER. In one transaction: the draft is locked, the
 * recipients are counted again and must equal the count the preview showed
 * (announcement_recipients_changed otherwise), one delivery row is written
 * per recipient per channel -- each marked queued, or skipped with its
 * reason -- and the announcement becomes `sending`. Delivery then happens in
 * batches (POST .../process), which the screen calls until nothing is left,
 * and which anyone may resume after a closed tab or a failure.
 *
 * The audit row carries the scope, the channels, the recipient count and the
 * per-channel plan -- never the text, a recipient or a contact.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: announcementSendSchema,
    handler: async ({ auth, body: raw, params }) => {
      requireWriter(auth);
      await requirePermission(auth, 'communications.send');
      const body = raw as AnnouncementSendInput;
      const id = idParam(params);

      const row = await audited(prisma, async (tx) => {
        const before = await loadAnnouncement(id, tx, true);
        if (!before) throw notFound();
        if (before.status !== 'draft') throw unprocessable('announcement_not_draft');
        const input = {
          scope: {
            kind: before.scope_kind,
            state_id: before.scope_state_id,
            activity: before.scope_activity as AnnouncementScope['activity'],
          },
          channels: before.channels,
          category: before.category,
        };
        const plan = await planSummary(input, tx);
        if (plan.recipients !== body.expected_recipients) {
          throw conflict('announcement_recipients_changed');
        }
        const willSend = Object.values(plan.byChannel).reduce((n, c) => n + (c?.send ?? 0), 0);
        if (willSend === 0) throw unprocessable('announcement_no_recipients');

        await queueDeliveries(tx, id, input);
        await tx.$executeRawUnsafe(
          `UPDATE public.announcement
              SET status = 'sending', sent_at = now(), sent_by = $2::uuid,
                  recipient_count = $3, updated_at = now()
            WHERE id = $1::uuid`,
          id,
          auth.principal.id,
          plan.recipients,
        );
        await writeAudit(tx, {
          entityType: 'announcement',
          entityId: id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'announcement.queued',
          before: { status: 'draft' },
          after: {
            status: 'sending',
            category: before.category,
            channels: before.channels,
            scope: input.scope,
            recipients: plan.recipients,
            plan: plan.byChannel,
          },
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
