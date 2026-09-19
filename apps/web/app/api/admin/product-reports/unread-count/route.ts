import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/admin/product-reports/unread-count — the navigation badge's ONLY
 * permitted source. ADMINISTRATOR ONLY.
 *
 * A count of live reports still in the `new` state, computed by the database
 * against `product_report_unread_idx`. Never derived from a loaded page, never
 * from browser storage, and never defaulted: if this route cannot answer, the
 * client shows no badge at all rather than a zero — because zero would claim
 * that nothing has been reported when the truth is that nobody looked.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async () => {
      const [row] = await prisma.$queryRawUnsafe<{ unread: number }[]>(
        `SELECT count(*)::int AS unread FROM public.product_report_active WHERE status = 'new'`,
      );
      return ok({ unread: row?.unread ?? 0 });
    },
  },
});
