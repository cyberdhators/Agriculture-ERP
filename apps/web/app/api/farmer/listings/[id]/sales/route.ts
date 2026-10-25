import {
  FARMER_ROLE,
  MARKET_POST_MESSAGES,
  canonicalStatus,
  listingSaleSchema,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { unprocessable } from '../../../../../../lib/api/errors';
import {
  OWN_LISTING_COLUMNS,
  loadOwnListing,
  presentOwnListing,
  type OwnListingRow,
} from '../../../../../../lib/api/farmer-accounts';
import { invalidField } from '../../../../../../lib/api/market-posts';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { farmerScope } from '../../../../../../lib/api/scope';
import { actingWith } from '../../../../../../lib/api/organizations';
import { prisma } from '../../../../../../lib/db';

/**
 * POST /api/farmer/listings/:id/sales -- the farmer records a sale. LISTINGS
 * LANE (2026-10-19).
 *
 * The owner: "recording a sale reduces the remaining quantity; the listing
 * closes as completed only when the owner says it is fulfilled or the
 * quantity reaches zero". So the quantity sold is added to `quantity_sold`
 * (what is left is `quantity - quantity_sold`), and the listing becomes
 * `completed` when nothing is left or when `close` is sent.
 *
 * NOT IDEMPOTENT, so it is never queued on the phone: sending a sale twice
 * would count it twice. The farmer's screen says a sale needs signal.
 *
 * The farmer's own listing only (the owner is in the WHERE clause), and only
 * while it is live or paused: a draft has sold nothing, and a withdrawn or
 * completed listing is finished.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE],
    bodySchema: listingSaleSchema,
    handler: async ({ auth, body, params, request }) => {
      const { farmerId } = farmerScope(auth);
      // 2026-10-28: an organisation's listing, for its members with listings.manage.
      const acting = await actingWith(prisma, request, auth, 'listings.manage');
      const id = params.id ?? '';
      const row = await audited(prisma, async (tx) => {
        const current = await loadOwnListing(
          tx,
          farmerId,
          id,
          true,
          acting?.organizationId ?? null,
        );
        const stage = canonicalStatus(current.status);
        if (stage !== 'active' && stage !== 'paused') throw unprocessable('transition_not_allowed');

        const total = Number(current.quantity);
        const soldBefore = Number(current.quantity_sold);
        const left = total - soldBefore;
        if (body.quantity > left + 1e-9) {
          throw invalidField('quantity', MARKET_POST_MESSAGES.saleAboveRemaining);
        }
        // Two decimal places, as the column stores them.
        const soldAfter = Math.min(total, Math.round((soldBefore + body.quantity) * 100) / 100);
        const closes = body.close || soldAfter >= total;

        const [updated] = await tx.$queryRawUnsafe<OwnListingRow[]>(
          `UPDATE public.produce_listing
              SET quantity_sold = $2,
                  status = CASE WHEN $3 THEN 'completed'::public.listing_status ELSE status END,
                  updated_at = now()
            WHERE id = $1::uuid
            RETURNING ${OWN_LISTING_COLUMNS}`,
          id,
          soldAfter,
          closes,
        );
        await writeAudit(tx, {
          entityType: 'produce_listing',
          entityId: id,
          actorType: 'farmer',
          actorId: farmerId,
          action: closes ? 'listing.status_changed' : 'listing.updated',
          before: { quantity_sold: soldBefore, status: current.status },
          after: {
            sale_quantity: body.quantity,
            quantity_sold: soldAfter,
            ...(closes ? { status: 'completed' } : {}),
          },
        });
        return updated!;
      });
      return ok(presentOwnListing(row));
    },
  },
});
