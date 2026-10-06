import { BUYER_ROLE, buyerCapabilities } from '@agri-erp/shared';

import { MARKET_BASE_WHERE, MARKET_FROM } from '../../../../lib/api/buyers';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { buyerScope } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/buyer/summary -- every figure on the buyer dashboard. B13,
 * C-14B.5 and C-14B.19.
 *
 * EVERY NUMBER HERE IS A QUERY. Nothing is estimated, carried over or
 * computed in a browser. Where a figure cannot be sourced it is null and the
 * screen says so, rather than printing a zero that would read as a fact.
 *
 * QUANTITIES ARE NEVER SUMMED ACROSS UNITS. Five bags and five kilograms are
 * not ten of anything, so "total quantity purchased" is a list of totals, one
 * per unit, and the screen shows each with its unit.
 *
 * Supply figures (what is available in the marketplace) follow the buyer's
 * standing: an account that may not browse is told nothing about supply.
 */

const ACTIVE_REQUEST = `('submitted','under_review','accepted','partially_fulfilled')`;
const IN_PROGRESS_ORDER = `('confirmed','processing','ready_for_delivery','in_transit')`;
const DONE_ORDER = `('delivered','completed')`;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [BUYER_ROLE],
    handler: async ({ auth }) => {
      const scope = buyerScope(auth);
      const org = scope.organizationId;
      const canBrowse = buyerCapabilities(scope.verification).browse;

      const [
        [requests],
        ordersByStatus,
        quantityByUnit,
        byMonth,
        byCategory,
        supplyByCategory,
        supplyByState,
        [available],
      ] = await Promise.all([
        prisma.$queryRawUnsafe<{ active: number; drafts: number }[]>(
          `SELECT count(*) FILTER (WHERE status IN ${ACTIVE_REQUEST})::int AS active,
                  count(*) FILTER (WHERE status = 'draft')::int AS drafts
             FROM public.purchase_request
            WHERE organization_id = $1::uuid AND deleted_at IS NULL`,
          org,
        ),
        prisma.$queryRawUnsafe<{ status: string; n: number }[]>(
          `SELECT status::text AS status, count(*)::int AS n FROM public.purchase_order
            WHERE organization_id = $1::uuid AND deleted_at IS NULL
            GROUP BY status ORDER BY status`,
          org,
        ),
        prisma.$queryRawUnsafe<{ unit: string; quantity: string }[]>(
          `SELECT unit::text AS unit, sum(quantity)::text AS quantity FROM public.purchase_order
            WHERE organization_id = $1::uuid AND deleted_at IS NULL AND status IN ${DONE_ORDER}
            GROUP BY unit ORDER BY unit`,
          org,
        ),
        // Twelve calendar months to this one, every month present even when
        // empty, so a chart's x-axis is time and not "months that had orders".
        prisma.$queryRawUnsafe<{ month: string; orders: number; total_ssp: string }[]>(
          `SELECT to_char(m.month, 'YYYY-MM') AS month,
                  count(o.id)::int AS orders,
                  coalesce(sum(o.total_ssp), 0)::text AS total_ssp
             FROM generate_series(date_trunc('month', now()) - interval '11 months',
                                  date_trunc('month', now()), interval '1 month') AS m(month)
             LEFT JOIN public.purchase_order o
               ON date_trunc('month', o.created_at) = m.month
              AND o.organization_id = $1::uuid AND o.deleted_at IS NULL
              AND o.status <> 'cancelled'
            GROUP BY m.month ORDER BY m.month`,
          org,
        ),
        prisma.$queryRawUnsafe<{ category: string; orders: number; total_ssp: string }[]>(
          `SELECT category::text AS category, count(*)::int AS orders,
                  sum(total_ssp)::text AS total_ssp
             FROM public.purchase_order
            WHERE organization_id = $1::uuid AND deleted_at IS NULL AND status <> 'cancelled'
            GROUP BY category ORDER BY sum(total_ssp) DESC, category`,
          org,
        ),
        canBrowse
          ? prisma.$queryRawUnsafe<{ category: string; listings: number }[]>(
              `SELECT pl.category::text AS category, count(*)::int AS listings ${MARKET_FROM}
                WHERE ${MARKET_BASE_WHERE}
                GROUP BY pl.category ORDER BY count(*) DESC, pl.category`,
            )
          : Promise.resolve(null),
        canBrowse
          ? prisma.$queryRawUnsafe<{ state_id: string; state: string; listings: number }[]>(
              `SELECT s.id AS state_id, s.name AS state, count(*)::int AS listings ${MARKET_FROM}
                WHERE ${MARKET_BASE_WHERE}
                GROUP BY s.id, s.name ORDER BY count(*) DESC, s.name`,
            )
          : Promise.resolve(null),
        canBrowse
          ? prisma.$queryRawUnsafe<{ n: number }[]>(
              `SELECT count(*)::int AS n ${MARKET_FROM} WHERE ${MARKET_BASE_WHERE}`,
            )
          : Promise.resolve([null]),
      ]);

      const count = (statuses: string) =>
        ordersByStatus
          .filter((r) => statuses.includes(`'${r.status}'`))
          .reduce((sum, r) => sum + r.n, 0);

      return ok({
        verification: scope.verification,
        kpis: {
          active_purchase_requests: requests?.active ?? 0,
          draft_purchase_requests: requests?.drafts ?? 0,
          available_products: available ? available.n : null,
          pending_orders: count(`('pending')`),
          orders_in_progress: count(IN_PROGRESS_ORDER),
          completed_purchases: count(DONE_ORDER),
          total_quantity_purchased: quantityByUnit.map((r) => ({
            unit: r.unit,
            quantity: Number(r.quantity),
          })),
        },
        procurement: {
          orders_by_status: ordersByStatus,
          purchases_by_month: byMonth.map((r) => ({
            month: r.month,
            orders: r.orders,
            total_ssp: Number(r.total_ssp),
          })),
          categories_purchased: byCategory.map((r) => ({
            category: r.category,
            orders: r.orders,
            total_ssp: Number(r.total_ssp),
          })),
        },
        supply: canBrowse ? { by_category: supplyByCategory, by_state: supplyByState } : null,
      });
    },
  },
});
