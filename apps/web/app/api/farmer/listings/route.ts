import { randomUUID } from 'node:crypto';

import {
  FARMER_ROLE,
  MARKET_POST_MESSAGES,
  canonicalStatus,
  defaultEndDate,
  farmerListingSchema,
  listingStoredStatus,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import {
  OWN_LISTING_COLUMNS,
  loadOwnListing,
  loadSelf,
  presentOwnListing,
  type OwnListingRow,
} from '../../../../lib/api/farmer-accounts';
import { conflict, unprocessable } from '../../../../lib/api/errors';
import { invalidField, todayUtc } from '../../../../lib/api/market-posts';
import { created, defineRoutes, ok } from '../../../../lib/api/route';
import { farmerScope } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';
import { listingValidityDays, refuseArchivedChoice } from '../../../../lib/api/settings';

/**
 * GET and POST /api/farmer/listings -- the farmer's own produce. B14.
 *
 * The farmer uploads their produce themselves (CORWADO, 2026-10-07). The owner
 * of a new listing is the session's farmer: the body has no farmer field, and
 * the payam and state are copied from the farmer's record. The contact phone
 * defaults to the farmer's own; it is shown to a buyer only after that buyer
 * has sent a request for this listing.
 *
 * Every listing, every status: a farmer sees their drafts and their sold
 * produce too. Newest change first. A farmer's own produce is a short list,
 * so it is returned whole.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE],
    handler: async ({ auth }) => {
      const { farmerId } = farmerScope(auth);
      const rows = await prisma.$queryRawUnsafe<OwnListingRow[]>(
        `SELECT ${OWN_LISTING_COLUMNS} FROM public.produce_listing
          WHERE farmer_id = $1::uuid AND deleted_at IS NULL
          ORDER BY updated_at DESC, id DESC LIMIT 200`,
        farmerId,
      );
      return ok(rows.map(presentOwnListing));
    },
  },

  POST: {
    roles: [FARMER_ROLE],
    bodySchema: farmerListingSchema,
    handler: async ({ auth, body }) => {
      const { farmerId } = farmerScope(auth);
      const farmer = await loadSelf(prisma, farmerId);
      const id = body.id ?? randomUUID();
      const [existing] = await prisma.$queryRawUnsafe<{ farmer_id: string }[]>(
        'SELECT farmer_id FROM public.produce_listing WHERE id = $1::uuid',
        id,
      );
      if (existing) {
        // PWA (2026-10-10): the same listing sent again -- the phone's retry
        // after a lost answer -- is the same listing (C-9 idempotent upload).
        // Its current state is returned; nothing is written twice. An id that
        // belongs to another farmer is still a conflict.
        if (existing.farmer_id !== farmerId) throw conflict('farmer_already_exists');
        return ok(presentOwnListing(await loadOwnListing(prisma, farmerId, id)));
      }

      // LISTINGS LANE (2026-10-19): no verification gate. The owner dropped
      // #127 -- a farmer's listing goes live without staff verification; the
      // market shows a "Verified farmer" badge instead, and never filters by
      // it. A new listing is a draft or live; every later move is a change.
      const canonical = canonicalStatus(body.status);
      if (canonical !== 'draft' && canonical !== 'active') {
        throw unprocessable('transition_not_allowed');
      }
      const status = listingStoredStatus(canonical);
      // No end date given: thirty days on the market (owner, 2026-10-19).
      const today = todayUtc();
      // 2026-10-27 (settings phase 2): the validity and the archived lists.
      await refuseArchivedChoice(body);
      const availableUntil = defaultEndDate(
        body.available_until,
        body.available_from,
        today,
        await listingValidityDays(),
      );
      if (availableUntil < body.available_from) {
        throw invalidField('available_until', MARKET_POST_MESSAGES.untilBeforeFrom);
      }
      if (status === 'listed' && availableUntil < today) {
        throw invalidField('available_until', MARKET_POST_MESSAGES.dateInPast);
      }

      const row = await audited(prisma, async (tx) => {
        const [inserted] = await tx.$queryRawUnsafe<OwnListingRow[]>(
          `INSERT INTO public.produce_listing
             (id, farmer_id, trading_name, title, category, product_name, description, quantity,
              unit, price_ssp, price_per, negotiable, delivery_available, available_from,
              available_until, harvest_season, pickup_notes, contact_phone, status, payam_id,
              state_id, quality_grade, min_order_quantity, show_phone)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::public.listing_category, $6, $7, $8,
                   $9::public.listing_unit, $10, $11::public.listing_unit, $12, $13, $14::date,
                   $15::date, $16, $17, $18, $19::public.listing_status, $20, $21,
                   $22::public.listing_grade, $23, $24)
           RETURNING ${OWN_LISTING_COLUMNS}`,
          id,
          farmerId,
          body.trading_name,
          body.title,
          body.category,
          body.product_name,
          body.description,
          body.quantity,
          body.unit,
          body.price_ssp,
          body.price_per,
          body.negotiable,
          body.delivery_available,
          body.available_from,
          availableUntil,
          body.harvest_season ?? null,
          body.pickup_notes ?? null,
          body.contact_phone ?? farmer.phone,
          status,
          farmer.payam_id,
          farmer.state_id,
          body.quality_grade ?? null,
          body.min_order_quantity ?? null,
          body.show_phone,
        );
        await writeAudit(tx, {
          entityType: 'produce_listing',
          entityId: id,
          actorType: 'farmer',
          actorId: farmerId,
          action: 'listing.created',
          after: {
            title: body.title,
            category: body.category,
            status,
            available_until: availableUntil,
          },
        });
        return inserted!;
      });
      return created(presentOwnListing(row));
    },
  },
});
