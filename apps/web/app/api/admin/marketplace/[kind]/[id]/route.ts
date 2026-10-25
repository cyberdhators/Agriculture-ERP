import { toIso, type AdminMarketplaceDetail } from '@agri-erp/shared';

import {
  DETAIL_SQL,
  KIND_SQL,
  REPORTS_SQL,
  kindOf,
  presentMarketplaceRow,
  type MarketplaceRow,
} from '../../../../../../lib/api/admin-marketplace';
import { notFound } from '../../../../../../lib/api/errors';
import {
  CORRECTION_SELECT,
  TARGET_COLUMN,
  presentCorrection,
  reasonCodesSetting,
  type CorrectionRow,
} from '../../../../../../lib/api/listing-corrections';
import { checkId } from '../../../../../../lib/api/market-posts';
import { requirePermission } from '../../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';

/**
 * GET /api/admin/marketplace/:kind/:id -- inspect one post (2026-10-28).
 * :kind is produce_listing | buying_request | service_listing. ADMINISTRATOR
 * ONLY, then `content.moderate`.
 *
 * The list's columns, the kind's own fields (never the contact phone), the
 * reports about it (never the reporter) and every correction request. A
 * draft, a soft-deleted post or an unknown kind is 404.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth, params }) => {
      await requirePermission(auth, 'content.moderate');
      const kind = kindOf(params.kind);
      if (!kind) throw notFound();
      const id = checkId(params.id);

      const [row] = await prisma.$queryRawUnsafe<MarketplaceRow[]>(
        `SELECT p.* FROM (${KIND_SQL[kind]}) p WHERE p.id = $1::uuid`,
        id,
      );
      if (!row) throw notFound();
      const [detail] = await prisma.$queryRawUnsafe<
        { details: AdminMarketplaceDetail['details'] }[]
      >(DETAIL_SQL[kind], id);
      const reports = await prisma.$queryRawUnsafe<
        {
          id: string;
          reason: string;
          description: string | null;
          status: string;
          created_at: Date;
        }[]
      >(REPORTS_SQL[kind], id);
      const corrections = await prisma.$queryRawUnsafe<CorrectionRow[]>(
        `${CORRECTION_SELECT} WHERE c.${TARGET_COLUMN[kind]} = $1::uuid
          ORDER BY c.requested_at DESC, c.id DESC LIMIT 50`,
        id,
      );
      const setting = await reasonCodesSetting(prisma);

      const body: AdminMarketplaceDetail = {
        ...presentMarketplaceRow(row),
        details: detail?.details ?? {},
        reports: reports.map((r) => ({ ...r, created_at: toIso(r.created_at) })),
        corrections: corrections.map((c) => presentCorrection(c, setting)),
      };
      return ok(body, { 'cache-control': 'no-store' });
    },
  },
});
