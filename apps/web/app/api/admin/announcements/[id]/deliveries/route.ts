import {
  ANNOUNCEMENT_LIMITS,
  decodeCursor,
  deliveryQuerySchema,
  encodeCursor,
  type AnnouncementDelivery,
} from '@agri-erp/shared';

import { idParam, loadAnnouncement } from '../../../../../../lib/api/announcements';
import { invalidCursor, notFound } from '../../../../../../lib/api/errors';
import { parseQuery } from '../../../../../../lib/api/market-posts';
import { requirePermission } from '../../../../../../lib/api/permissions';
import { defineRoutes, paged } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';

interface Row {
  id: string;
  channel: AnnouncementDelivery['channel'];
  recipient_kind: AnnouncementDelivery['recipient_kind'];
  recipient_name: string | null;
  status: AnnouncementDelivery['status'];
  skip_reason: AnnouncementDelivery['skip_reason'];
  provider_message_id: string | null;
  error: string | null;
  attempts: number;
  sent_at: Date | null;
  updated_at: Date;
  created_at: Date;
}

/**
 * GET /api/admin/announcements/:id/deliveries?channel=&status=&cursor=
 * (2026-10-27). ADMINISTRATOR ONLY, then `communications.send`.
 *
 * The delivery record: one row per recipient per channel, 100 a page, with
 * its status, the reason it was skipped, the provider's message id and the
 * provider's error. The recipient is named (staff may see account names);
 * NO phone number and NO address is returned -- they are not stored here.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth, params, request }) => {
      await requirePermission(auth, 'communications.send');
      const id = idParam(params);
      const query = parseQuery(request, deliveryQuerySchema);
      if (!(await loadAnnouncement(id))) throw notFound();

      const where = ['d.announcement_id = $1::uuid'];
      const values: unknown[] = [id];
      if (query.channel) {
        values.push(query.channel);
        where.push(`d.channel = $${values.length}`);
      }
      if (query.status) {
        values.push(query.status);
        where.push(`d.status = $${values.length}`);
      }
      if (query.cursor) {
        const cursor = decodeCursor(query.cursor);
        if (!cursor) throw invalidCursor();
        values.push(cursor.createdAt, cursor.id);
        where.push(
          `(d.created_at, d.id) > ($${values.length - 1}::timestamptz, $${values.length}::uuid)`,
        );
      }
      const limit = ANNOUNCEMENT_LIMITS.deliveriesPageMax;
      const rows = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT d.id, d.channel, d.recipient_kind,
                COALESCE(f.given_name || ' ' || f.family_name, b.given_name || ' ' || b.family_name,
                         o.name, u.name) AS recipient_name,
                d.status, d.skip_reason, d.provider_message_id, d.error, d.attempts,
                d.sent_at, d.updated_at, d.created_at
           FROM public.announcement_delivery d
           LEFT JOIN public.farmer f ON d.recipient_kind = 'farmer' AND f.id = d.recipient_id
           LEFT JOIN public.buyer b ON d.recipient_kind = 'buyer' AND b.id = d.recipient_id
           LEFT JOIN public.officer o ON d.recipient_kind = 'officer' AND o.id = d.recipient_id
           LEFT JOIN public."user" u ON d.recipient_kind = 'staff' AND u.id = d.recipient_id
          WHERE ${where.join(' AND ')}
          ORDER BY d.created_at, d.id
          LIMIT ${limit + 1}`,
        ...values,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(
        page.map((r): AnnouncementDelivery => ({
          id: r.id,
          channel: r.channel,
          recipient_kind: r.recipient_kind,
          recipient_name: r.recipient_name,
          status: r.status,
          skip_reason: r.skip_reason,
          provider_message_id: r.provider_message_id,
          error: r.error,
          attempts: r.attempts,
          sent_at: r.sent_at?.toISOString() ?? null,
          updated_at: r.updated_at.toISOString(),
        })),
        {
          cursor:
            hasMore && last
              ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
              : null,
          hasMore,
        },
      );
    },
  },
});
