import {
  FARMER_ROLE,
  MARKET_POST_MESSAGES,
  canonicalStatus,
  defaultEndDate,
  farmerListingPatchSchema,
  listingStoredStatus,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { matchAlertsAfter } from '../../../../../lib/api/match-alerts';
import {
  OWN_LISTING_COLUMNS,
  loadOwnListing,
  presentOwnListing,
  type OwnListingRow,
} from '../../../../../lib/api/farmer-accounts';
import { ApiFailure } from '../../../../../lib/api/errors';
import { addressCorrections, sentKeys } from '../../../../../lib/api/listing-corrections';
import { checkLifecycle, invalidField, todayUtc } from '../../../../../lib/api/market-posts';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { farmerScope } from '../../../../../lib/api/scope';
import { actingWith } from '../../../../../lib/api/organizations';
import { prisma } from '../../../../../lib/db';
import { listingValidityDays } from '../../../../../lib/api/settings';

/**
 * GET and PATCH /api/farmer/listings/:id -- one of the farmer's own listings.
 * B14. Another farmer's listing is 404, as is one that never existed: the
 * owner is in the WHERE clause. Withdrawing or marking sold is a status change
 * here; nothing is ever deleted.
 *
 * LISTINGS LANE (2026-10-19): the lifecycle. Publish, pause, resume, withdraw
 * and complete are status changes; renew is a new `available_until`. The moves
 * are checked here (canMove in packages/shared): withdrawn and completed are
 * final, so a listing staff took down cannot be switched back on by a stale
 * edit. No verification gate. Recording a sale is its own route (./sales).
 * A full-listing save from the phone's outbox still works: an unchanged
 * status is not a move.
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
    handler: async ({ auth, params, request }) => {
      // 2026-10-28: an organisation's listing, for its members with listings.manage.
      const acting = await actingWith(prisma, request, auth, 'listings.manage');
      return ok(
        presentOwnListing(
          await loadOwnListing(
            prisma,
            farmerScope(auth).farmerId,
            params.id ?? '',
            false,
            acting?.organizationId ?? null,
          ),
        ),
      );
    },
  },

  PATCH: {
    roles: [FARMER_ROLE],
    bodySchema: farmerListingPatchSchema,
    handler: async ({ auth, body, params, request }) => {
      const { farmerId } = farmerScope(auth);
      // 2026-10-28: an organisation's listing, for its members with listings.manage.
      const acting = await actingWith(prisma, request, auth, 'listings.manage');
      const id = params.id ?? '';
      let wentLive = false;
      const row = await audited(prisma, async (tx) => {
        const current = await loadOwnListing(
          tx,
          farmerId,
          id,
          true,
          acting?.organizationId ?? null,
        );
        // The legacy `sold` is written as `completed` from now on.
        if (body.status !== undefined)
          body.status = listingStoredStatus(canonicalStatus(body.status)) as typeof body.status;
        // Going live with no end date: thirty days on the market (owner, 2026-10-19).
        const today = todayUtc();
        const goesLive = body.status === 'listed' && canonicalStatus(current.status) !== 'active';
        wentLive = goesLive;
        if (goesLive && (body.available_until ?? current.available_until) == null) {
          body.available_until = defaultEndDate(
            null,
            body.available_from ?? current.available_from,
            today,
            await listingValidityDays(),
          );
        }
        const endChanged =
          body.available_until !== undefined && body.available_until !== current.available_until;
        const endDate =
          body.available_until !== undefined ? body.available_until : current.available_until;
        checkLifecycle({
          from: current.status,
          to: body.status,
          endField: 'available_until',
          endDate: endDate ?? null,
          endChanged,
          today,
        });
        const from = body.available_from ?? current.available_from;
        if (endDate && endDate < from) {
          throw invalidField('available_until', MARKET_POST_MESSAGES.untilBeforeFrom);
        }
        // What has been sold stays sold: the total cannot drop below it.
        if (body.quantity !== undefined && body.quantity < Number(current.quantity_sold)) {
          throw invalidField('quantity', MARKET_POST_MESSAGES.quantityBelowSold);
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
          before:
            body.status !== undefined || endChanged
              ? { status: current.status, available_until: current.available_until }
              : null,
          after: changed,
        });
        // 2026-10-27: an edit of the content addresses an open correction request.
        await addressCorrections(tx, 'produce_listing', id, sentKeys(body), {
          actorType: 'farmer',
          actorId: farmerId,
        });
        return updated!;
      });
      // 2026-10-26: a listing that has just gone on the market alerts matching buyers.
      matchAlertsAfter('listing', row.id, false, wentLive);
      return ok(presentOwnListing(row));
    },
  },
});
