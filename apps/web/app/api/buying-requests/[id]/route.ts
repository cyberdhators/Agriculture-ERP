import {
  BUYER_ROLE,
  FARMER_ROLE,
  MARKET_POST_MESSAGES,
  buyingRequestPatchSchema,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { notFound } from '../../../../lib/api/errors';
import { addressCorrections, sentKeys } from '../../../../lib/api/listing-corrections';
import {
  BUYING_REQUEST_COLUMNS,
  BUYING_REQUEST_FROM,
  BUYING_REQUEST_MARKET_WHERE,
  checkId,
  checkLifecycle,
  invalidField,
  loadOwnBuyingRequest,
  actingPoster,
  presentBuyingRequest,
  presentOwnBuyingRequest,
  todayUtc,
  type BuyingRequestRow,
} from '../../../../lib/api/market-posts';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * /api/buying-requests/:id. LISTINGS LANE (2026-10-19).
 *
 * GET is public and answers only for what is on the market (active, date not
 * passed, poster still here); anything else is the house 404, so a draft or a
 * withdrawn request is indistinguishable from one that never existed.
 *
 * PATCH is the poster's own: an edit, or a move through the lifecycle --
 * publish, pause, resume, withdraw, complete -- or a renewal (a new
 * needed_by). The poster is in the WHERE clause; another account's request is
 * 404. Withdrawn and completed are final. Nothing is ever deleted.
 */
const CASTS: Record<string, string> = {
  category: '::public.listing_category',
  unit: '::public.listing_unit',
  price_per: '::public.listing_unit',
  needed_by: '::date',
};

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async ({ params }) => {
      const [row] = await prisma.$queryRawUnsafe<BuyingRequestRow[]>(
        `SELECT ${BUYING_REQUEST_COLUMNS} ${BUYING_REQUEST_FROM}
          WHERE br.id = $1::uuid AND ${BUYING_REQUEST_MARKET_WHERE}`,
        checkId(params.id),
      );
      if (!row) throw notFound();
      return ok(presentBuyingRequest(row));
    },
  },

  PATCH: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: buyingRequestPatchSchema,
    handler: async ({ auth, body, params, request }) => {
      // 2026-10-27: an organisation's post is managed by its members with listings.manage.
      const poster = await actingPoster(prisma, request, auth);
      const id = checkId(params.id);
      const row = await audited(prisma, async (tx) => {
        const current = await loadOwnBuyingRequest(tx, poster, id, true);
        const endChanged = body.needed_by !== undefined && body.needed_by !== current.needed_by;
        checkLifecycle({
          from: current.status,
          to: body.status,
          endField: 'needed_by',
          endDate: body.needed_by ?? current.needed_by,
          endChanged,
          today: todayUtc(),
        });
        if (body.state_id !== undefined) {
          const [state] = await tx.$queryRawUnsafe<{ id: string }[]>(
            'SELECT id FROM public.state WHERE id = $1 AND deleted_at IS NULL',
            body.state_id,
          );
          if (!state) throw invalidField('state_id', MARKET_POST_MESSAGES.stateUnknown);
        }
        // A price needs its unit, whichever of the two this change sends.
        const price = body.price_ssp !== undefined ? body.price_ssp : current.price_ssp;
        const per = body.price_per !== undefined ? body.price_per : current.price_per;
        if (price != null && per == null) {
          throw invalidField('price_per', MARKET_POST_MESSAGES.priceUnitRequired);
        }

        const sets: string[] = [];
        const values: unknown[] = [];
        const changed: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(body)) {
          if (value === undefined) continue;
          values.push(value);
          sets.push(`${key} = $${values.length}${CASTS[key] ?? ''}`);
          // The contact phone and free text are not recorded in the log.
          if (!['contact_phone', 'description', 'delivery_terms'].includes(key))
            changed[key] = value;
        }
        values.push(id);
        await tx.$executeRawUnsafe(
          `UPDATE public.buying_request SET ${sets.join(', ')}, updated_at = now()
            WHERE id = $${values.length}::uuid`,
          ...values,
        );
        const moved = body.status !== undefined && body.status !== current.status;
        await writeAudit(tx, {
          entityType: 'buying_request',
          entityId: id,
          actorType: poster.type,
          actorId: poster.id,
          action: moved ? 'listing.status_changed' : 'listing.updated',
          before:
            moved || endChanged ? { status: current.status, needed_by: current.needed_by } : null,
          after: changed,
        });
        // 2026-10-27: an edit of the content addresses an open correction request.
        await addressCorrections(tx, 'buying_request', id, sentKeys(body), {
          actorType: poster.type,
          actorId: poster.id,
        });
        return loadOwnBuyingRequest(tx, poster, id);
      });
      return ok(presentOwnBuyingRequest(row));
    },
  },
});
