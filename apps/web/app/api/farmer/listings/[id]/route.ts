import { FARMER_ROLE, farmerListingPatchSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import {
  OWN_LISTING_COLUMNS,
  loadOwnListing,
  presentOwnListing,
  type OwnListingRow,
} from '../../../../../lib/api/farmer-accounts';
import { ApiFailure, unprocessable } from '../../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { farmerScope } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/**
 * GET and PATCH /api/farmer/listings/:id -- one of the farmer's own listings.
 * B14. Another farmer's listing is 404, as is one that never existed: the
 * owner is in the WHERE clause. Withdrawing or marking sold is a status change
 * here; nothing is ever deleted.
 */
const CASTS: Record<string, string> = {
  category: '::public.listing_category',
  unit: '::public.listing_unit',
  price_per: '::public.listing_unit',
  available_from: '::date',
  available_until: '::date',
  status: '::public.listing_status',
  quality_grade: '::public.listing_grade',
};

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE],
    handler: async ({ auth, params }) =>
      ok(
        presentOwnListing(
          await loadOwnListing(prisma, farmerScope(auth).farmerId, params.id ?? ''),
        ),
      ),
  },

  PATCH: {
    roles: [FARMER_ROLE],
    bodySchema: farmerListingPatchSchema,
    handler: async ({ auth, body, params }) => {
      const { farmerId } = farmerScope(auth);
      const id = params.id ?? '';
      const row = await audited(prisma, async (tx) => {
        const current = await loadOwnListing(tx, farmerId, id, true);
        // B14: only a verified farmer may put a listing live.
        if (body.status === 'listed' && current.status !== 'listed') {
          const [self] = await tx.$queryRawUnsafe<{ verification_status: string }[]>(
            'SELECT verification_status::text AS verification_status FROM public.farmer WHERE id = $1::uuid',
            farmerId,
          );
          if (self?.verification_status !== 'verified') throw unprocessable('farmer_not_verified');
        }
        const quantity = body.quantity ?? Number(current.quantity);
        const minOrder =
          body.min_order_quantity !== undefined
            ? body.min_order_quantity
            : current.min_order_quantity === null
              ? null
              : Number(current.min_order_quantity);
        if (minOrder !== null && minOrder > quantity) {
          throw new ApiFailure(
            400,
            'invalid_input',
            'Some of the information sent was not valid.',
            {
              min_order_quantity: 'The minimum order cannot be more than the quantity.',
            },
          );
        }
        const sets: string[] = [];
        const values: unknown[] = [];
        const changed: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(body)) {
          if (value === undefined) continue;
          values.push(value);
          sets.push(`${key} = $${values.length}${CASTS[key] ?? ''}`);
          // The contact phone and pickup notes are not recorded in the log.
          if (key !== 'contact_phone' && key !== 'pickup_notes') changed[key] = value;
        }
        values.push(id);
        const [updated] = await tx.$queryRawUnsafe<OwnListingRow[]>(
          `UPDATE public.produce_listing SET ${sets.join(', ')}, updated_at = now()
            WHERE id = $${values.length}::uuid RETURNING ${OWN_LISTING_COLUMNS}`,
          ...values,
        );
        await writeAudit(tx, {
          entityType: 'produce_listing',
          entityId: id,
          actorType: 'farmer',
          actorId: farmerId,
          action:
            body.status !== undefined && body.status !== current.status
              ? 'listing.status_changed'
              : 'listing.updated',
          before: body.status !== undefined ? { status: current.status } : null,
          after: changed,
        });
        return updated!;
      });
      return ok(presentOwnListing(row));
    },
  },
});
