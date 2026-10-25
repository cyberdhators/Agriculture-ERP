import { BUYER_ROLE, FARMER_ROLE, type AccountAnnouncement } from '@agri-erp/shared';

import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/account/announcements (2026-10-27). The official announcements
 * this account received in the app, newest first (the latest 50), as they
 * were delivered to its inbox: its farmer record's, or its buyer
 * organisation's. Nothing addressed to anyone else; nothing still a draft.
 */
interface Row {
  id: string;
  title: string;
  body: string;
  category: AccountAnnouncement['category'];
  sent_at: Date;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth }) => {
      const farmerId = auth.scope.kind === 'farmer' ? auth.scope.farmerId : null;
      const organizationId = auth.scope.kind === 'buyer' ? auth.scope.organizationId : null;
      const rows = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT a.id, n.title, n.body, a.category, d.sent_at
           FROM public.announcement_delivery d
           JOIN public.announcement a ON a.id = d.announcement_id AND a.deleted_at IS NULL
           JOIN public.notification n ON n.id = d.notification_id AND n.deleted_at IS NULL
          WHERE d.channel = 'in_app' AND d.status = 'sent'
            AND (n.farmer_id = $1::uuid OR n.buyer_organization_id = $2::uuid)
          ORDER BY d.sent_at DESC, a.id
          LIMIT 50`,
        farmerId,
        organizationId,
      );
      return ok(
        rows.map(
          (r): AccountAnnouncement => ({
            id: r.id,
            title: r.title,
            body: r.body,
            category: r.category,
            sent_at: r.sent_at.toISOString(),
          }),
        ),
      );
    },
  },
});
