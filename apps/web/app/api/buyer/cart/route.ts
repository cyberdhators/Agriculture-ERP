import { BUYER_ROLE, cartCheckoutSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import {
  MARKET_BASE_WHERE,
  MARKET_FROM,
  REQUEST_COLUMNS,
  REQUEST_FROM,
  buyerActor,
  checkRequestedItems,
  notifyFarmerOfRequest,
  presentRequest,
  requireVerified,
  type RequestRow,
} from '../../../../lib/api/buyers';
import { unprocessable } from '../../../../lib/api/errors';
import { created, defineRoutes } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * POST /api/buyer/cart -- send the cart. B14 (2026-10-07).
 *
 * A buyer gathers products from different farmers and sends them together.
 * Each line becomes its own purchase request to the farmer who listed it, and
 * each farmer is alerted on their dashboard; the buyer gets each farmer's
 * number back on the request. One transaction: every request is sent or
 * none is. The cart itself lives in the buyer's browser until it is sent.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [BUYER_ROLE],
    bodySchema: cartCheckoutSchema,
    handler: async ({ auth, body }) => {
      const scope = requireVerified(auth);
      const listingIds = [...new Set(body.items.map((i: { listing_id: string }) => i.listing_id))];

      // Every product must be one a buyer could see right now.
      const listings = await prisma.$queryRawUnsafe<
        { id: string; category: string; product_name: string }[]
      >(
        `SELECT pl.id, pl.category::text AS category, pl.product_name ${MARKET_FROM}
          WHERE ${MARKET_BASE_WHERE} AND pl.id = ANY($1::uuid[])`,
        listingIds,
      );
      if (listings.length !== listingIds.length) throw unprocessable('listing_not_available');
      // Quantity, minimum order, duplicates and requests already waiting.
      await checkRequestedItems(
        prisma,
        scope.organizationId,
        body.items,
        (i) => `items.${i}.quantity`,
      );
      const byId = new Map(listings.map((l) => [l.id, l]));

      const ids = await audited(prisma, async (tx) => {
        const out: string[] = [];
        for (const item of body.items) {
          const listing = byId.get(item.listing_id)!;
          const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO public.purchase_request
               (organization_id, created_by, listing_id, category, product_name, quantity, unit,
                delivery_location, required_by, notes, status, submitted_at)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::public.listing_category, $5, $6,
                     $7::public.listing_unit, $8, $9::date, $10, 'submitted', now())
             RETURNING id`,
            scope.organizationId,
            scope.buyerId,
            item.listing_id,
            listing.category,
            listing.product_name,
            item.quantity,
            item.unit,
            body.delivery_location,
            body.required_by ?? null,
            item.notes ?? null,
          );
          await writeAudit(tx, {
            entityType: 'purchase_request',
            entityId: row!.id,
            ...buyerActor(auth),
            action: 'purchase_request.created',
            after: {
              listing_id: item.listing_id,
              quantity: item.quantity,
              unit: item.unit,
              status: 'submitted',
              via: 'cart',
            },
          });
          await notifyFarmerOfRequest(tx, item.listing_id, buyerActor(auth));
          out.push(row!.id);
        }
        return out;
      });

      const rows = await prisma.$queryRawUnsafe<RequestRow[]>(
        `SELECT ${REQUEST_COLUMNS} ${REQUEST_FROM} WHERE r.id = ANY($1::uuid[])
          ORDER BY r.created_at, r.id`,
        ids,
      );
      return created(rows.map(presentRequest));
    },
  },
});
