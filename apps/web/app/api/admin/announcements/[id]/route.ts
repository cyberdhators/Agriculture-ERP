import {
  announcementDraftSchema,
  remainingDeliveries,
  type AnnouncementDraftInput,
} from '@agri-erp/shared';

import {
  checkDraftReferences,
  deliveryCounts,
  smsReceiptCounts,
  idParam,
  loadAnnouncement,
  presentAnnouncement,
} from '../../../../../lib/api/announcements';
import { audited, writeAudit } from '../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../lib/api/errors';
import { requirePermission } from '../../../../../lib/api/permissions';
import { defineRoutes, empty, ok } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/**
 * /api/admin/announcements/:id (2026-10-27). ADMINISTRATOR ONLY, then
 * `communications.send`.
 *
 * GET    -- the announcement, with its delivery counts per channel and status
 *           and how many are still waiting.
 * PUT    -- the whole draft, replaced. Only a draft (announcement_not_draft).
 * DELETE -- discard a draft, SOFTLY (deleted_at). A sent announcement stays.
 *
 * The audit row names the changed fields, never the text.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth, params }) => {
      await requirePermission(auth, 'communications.send');
      const row = await loadAnnouncement(idParam(params));
      if (!row) throw notFound();
      const [counts, smsReceipts] = await Promise.all([
        deliveryCounts(row.id),
        smsReceiptCounts(row.id),
      ]);
      return ok({
        announcement: presentAnnouncement(row),
        deliveries: counts,
        remaining: remainingDeliveries(counts),
        // 2026-10-26: "sent" (Bird accepted) beside "delivered to phone" (the carrier said so).
        sms_receipts: smsReceipts,
      });
    },
  },

  PUT: {
    roles: ['admin', 'supervisor'],
    bodySchema: announcementDraftSchema,
    handler: async ({ auth, body: raw, params }) => {
      requireWriter(auth);
      await requirePermission(auth, 'communications.send');
      const body = raw as AnnouncementDraftInput;
      const id = idParam(params);
      const row = await audited(prisma, async (tx) => {
        const before = await loadAnnouncement(id, tx, true);
        if (!before) throw notFound();
        if (before.status !== 'draft') throw unprocessable('announcement_not_draft');
        await checkDraftReferences(tx, body);
        const smsBody = body.channels.includes('sms') ? body.sms_body : null;
        const next = {
          title: body.title,
          body: body.body,
          sms_body: smsBody,
          category: body.category,
          channels: body.channels.join(','),
          scope: `${body.scope.kind}|${body.scope.state_id ?? ''}|${body.scope.activity ?? ''}`,
          template_id: body.template_id,
        };
        const prev = {
          title: before.title,
          body: before.body,
          sms_body: before.sms_body,
          category: before.category,
          channels: before.channels.join(','),
          scope: `${before.scope_kind}|${before.scope_state_id ?? ''}|${before.scope_activity ?? ''}`,
          template_id: before.template_id,
        };
        const fields = (Object.keys(next) as (keyof typeof next)[]).filter(
          (k) => next[k] !== prev[k],
        );
        if (fields.length === 0) return before;
        await tx.$executeRawUnsafe(
          `UPDATE public.announcement
              SET title = $2, body = $3, sms_body = $4, category = $5, channels = $6::text[],
                  scope_kind = $7, scope_state_id = $8, scope_activity = $9,
                  template_id = $10::uuid, updated_at = now()
            WHERE id = $1::uuid`,
          id,
          body.title,
          body.body,
          smsBody,
          body.category,
          body.channels,
          body.scope.kind,
          body.scope.state_id,
          body.scope.activity,
          body.template_id,
        );
        await writeAudit(tx, {
          entityType: 'announcement',
          entityId: id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'announcement.draft_edited',
          after: { fields, category: body.category, channels: body.channels, scope: body.scope },
        });
        return (await loadAnnouncement(id, tx)) ?? before;
      });
      return ok(presentAnnouncement(row));
    },
  },

  DELETE: {
    roles: ['admin', 'supervisor'],
    handler: async ({ auth, params }) => {
      requireWriter(auth);
      await requirePermission(auth, 'communications.send');
      const id = idParam(params);
      await audited(prisma, async (tx) => {
        const before = await loadAnnouncement(id, tx, true);
        if (!before) throw notFound();
        if (before.status !== 'draft') throw unprocessable('announcement_not_draft');
        await tx.$executeRawUnsafe(
          `UPDATE public.announcement SET deleted_at = now(), deleted_by = $2::uuid, updated_at = now()
            WHERE id = $1::uuid`,
          id,
          auth.principal.id,
        );
        await writeAudit(tx, {
          entityType: 'announcement',
          entityId: id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'announcement.draft_discarded',
          before: { status: 'draft' },
          after: { deleted: true },
        });
      });
      return empty(204);
    },
  },
});
