import {
  BUYER_MESSAGES,
  DEFAULT_LIMIT,
  ERROR_CODES,
  ERROR_MESSAGES,
  MAX_LIMIT,
  PURCHASE_ORDER_STATUSES,
  buyerCapabilities,
  buyerListFilterSchema,
  createOrderSchema,
  type BuyerVerificationStatus,
  decodeCursor,
  encodeCursor,
  zodErrorToApiError,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import {
  MARKET_BASE_WHERE,
  ORDER_COLUMNS,
  ORDER_FROM,
  notifyOrganization,
  presentOrder,
  type OrderRow,
} from '../../../../lib/api/buyers';
import { ApiFailure, invalidCursor, unprocessable } from '../../../../lib/api/errors';
import { created, defineRoutes, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET and POST /api/admin/orders. Administrator only. B13, C-14B.12.
 *
 * AN ORDER IS ARRANGED BY CORWADO, AGAINST A LISTING. The product, category,
 * unit and seller are copied from the listing on the server, so an order
 * cannot describe one thing while pointing at another; the total is generated
 * by the database. The buyer organisation must be verified, the listing must
 * be one the marketplace would show, the quantity must fit what is listed,
 * and a linked request must be that organisation's and already accepted.
 *
 * No payment is taken or recorded. An order is an agreement to supply.
 */
type AdminOrderRow = OrderRow & { organization_id: string; organization_name: string };

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ request }) => {
      const parsed = buyerListFilterSchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success) {
        const { body } = zodErrorToApiError(parsed.error);
        throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
      }
      const filter = parsed.data;
      let limit = DEFAULT_LIMIT;
      if (filter.limit !== undefined) {
        const n = Number(filter.limit);
        if (!Number.isInteger(n) || n < 1) throw invalidCursor();
        limit = Math.min(n, MAX_LIMIT);
      }
      const params: unknown[] = [];
      const where = ['o.deleted_at IS NULL'];
      if (filter.status) {
        if (!(PURCHASE_ORDER_STATUSES as readonly string[]).includes(filter.status)) {
          throw new ApiFailure(400, ERROR_CODES.invalidInput, ERROR_MESSAGES.invalidInput, {
            status: BUYER_MESSAGES.statusFilterUnknown,
          });
        }
        params.push(filter.status);
        where.push(`o.status = $${params.length}::public.purchase_order_status`);
      }
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(o.created_at, o.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }
      const rows = await prisma.$queryRawUnsafe<AdminOrderRow[]>(
        `SELECT ${ORDER_COLUMNS}, o.organization_id, org.name AS organization_name
           ${ORDER_FROM}
           JOIN public.buyer_organization org ON org.id = o.organization_id
          WHERE ${where.join(' AND ')}
          ORDER BY o.created_at DESC, o.id DESC
          LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(
        page.map((r) => ({
          ...presentOrder(r),
          organization: { id: r.organization_id, name: r.organization_name },
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

  POST: {
    roles: ['admin'],
    bodySchema: createOrderSchema,
    handler: async ({ auth, body }) => {
      const actor = { actorType: 'admin' as const, actorId: auth.principal.id };

      const id = await audited(prisma, async (tx) => {
        const [org] = await tx.$queryRawUnsafe<{ verification_status: string }[]>(
          `SELECT verification_status::text AS verification_status
             FROM public.buyer_organization_active WHERE id = $1::uuid`,
          body.organization_id,
        );
        if (!org) throw unprocessable('request_other_organization');
        // Verified businesses and individuals (who need no review) may receive
        // orders; the shared rule decides, so the two cannot drift.
        if (!buyerCapabilities(org.verification_status as BuyerVerificationStatus).request) {
          throw unprocessable('buyer_not_verified');
        }

        // Locked: two orders against one listing cannot both pass the quantity check.
        const [listing] = await tx.$queryRawUnsafe<
          {
            farmer_id: string;
            category: string;
            product_name: string;
            quantity: string;
            unit: string;
          }[]
        >(
          `SELECT pl.farmer_id, pl.category::text AS category, pl.product_name,
                  pl.quantity::text AS quantity, pl.unit::text AS unit
             FROM public.produce_listing pl
             JOIN public.farmer_active f ON f.id = pl.farmer_id
            WHERE ${MARKET_BASE_WHERE} AND pl.deleted_at IS NULL AND pl.id = $1::uuid
            FOR UPDATE OF pl`,
          body.listing_id,
        );
        if (!listing) throw unprocessable('listing_not_available');
        if (body.quantity > Number(listing.quantity)) throw unprocessable('order_exceeds_listing');

        if (body.purchase_request_id) {
          const [request] = await tx.$queryRawUnsafe<{ organization_id: string; status: string }[]>(
            `SELECT organization_id, status::text AS status FROM public.purchase_request
              WHERE id = $1::uuid AND deleted_at IS NULL FOR UPDATE`,
            body.purchase_request_id,
          );
          if (!request || request.organization_id !== body.organization_id) {
            throw unprocessable('request_other_organization');
          }
          if (request.status !== 'accepted' && request.status !== 'partially_fulfilled') {
            throw unprocessable('transition_not_allowed');
          }
        }

        const [row] = await tx.$queryRawUnsafe<{ id: string; order_number: string }[]>(
          `INSERT INTO public.purchase_order
             (organization_id, purchase_request_id, listing_id, farmer_id, category, product_name,
              quantity, unit, unit_price_ssp, delivery_location, expected_delivery_date, created_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::public.listing_category, $6, $7,
                   $8::public.listing_unit, $9, $10, $11::date, $12::uuid)
           RETURNING id, order_number`,
          body.organization_id,
          body.purchase_request_id ?? null,
          body.listing_id,
          listing.farmer_id,
          listing.category,
          listing.product_name,
          body.quantity,
          listing.unit,
          body.unit_price_ssp,
          body.delivery_location,
          body.expected_delivery_date ?? null,
          auth.principal.id,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO public.delivery_update (order_id, status, recorded_by_user)
           VALUES ($1::uuid, 'pending', $2::uuid)`,
          row!.id,
          auth.principal.id,
        );
        await writeAudit(tx, {
          entityType: 'purchase_order',
          entityId: row!.id,
          ...actor,
          action: 'purchase_order.created',
          after: {
            order_number: row!.order_number,
            organization_id: body.organization_id,
            listing_id: body.listing_id,
            purchase_request_id: body.purchase_request_id ?? null,
            quantity: body.quantity,
            unit: listing.unit,
            unit_price_ssp: body.unit_price_ssp,
          },
        });
        await notifyOrganization(tx, body.organization_id, 'order_created', actor);
        return row!.id;
      });

      const [order] = await prisma.$queryRawUnsafe<OrderRow[]>(
        `SELECT ${ORDER_COLUMNS} ${ORDER_FROM} WHERE o.id = $1::uuid`,
        id,
      );
      return created(presentOrder(order!));
    },
  },
});
