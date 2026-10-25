import {
  BUYER_ROLE,
  FARMER_ROLE,
  MARKET_POST_MESSAGES,
  canonicalStatus,
  defaultEndDate,
  serviceListingPatchSchema,
  servicePosterIssue,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { notFound } from '../../../../lib/api/errors';
import { addressCorrections, sentKeys } from '../../../../lib/api/listing-corrections';
import {
  SERVICE_COLUMNS,
  SERVICE_FROM,
  SERVICE_MARKET_WHERE,
  checkId,
  checkLifecycle,
  invalidField,
  loadOwnService,
  actingPoster,
  presentOwnService,
  presentService,
  todayUtc,
  type ServiceRow,
} from '../../../../lib/api/market-posts';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * /api/services/:id. LISTINGS LANE (2026-10-19).
 *
 * GET is public and answers only for a service on the market; anything else
 * is the house 404.
 *
 * PATCH is the owning account's -- a farmer's or (2026-10-26) a buyer
 * account's, by the session: an edit, a move through the lifecycle
 * (publish, pause, resume, withdraw, complete) or a renewal (a new
 * available_until). No stock, so no sales. Withdrawn and completed are final.
 * A buyer account may move its service to another state (checked against the
 * list); a farmer's location stays its record's, so a farmer may not send one.
 */
const CASTS: Record<string, string> = {
  available_from: '::date',
  available_until: '::date',
};

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async ({ params }) => {
      const [row] = await prisma.$queryRawUnsafe<ServiceRow[]>(
        `SELECT ${SERVICE_COLUMNS} ${SERVICE_FROM}
          WHERE sl.id = $1::uuid AND ${SERVICE_MARKET_WHERE}`,
        checkId(params.id),
      );
      if (!row) throw notFound();
      return ok(presentService(row));
    },
  },

  PATCH: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: serviceListingPatchSchema,
    handler: async ({ auth, body, params, request }) => {
      // 2026-10-27: an organisation's post is managed by its members with listings.manage.
      const poster = await actingPoster(prisma, request, auth);
      const id = checkId(params.id);
      const issue = servicePosterIssue(poster.type, body, false);
      if (issue) throw invalidField(issue.field, issue.message);
      const row = await audited(prisma, async (tx) => {
        const current = await loadOwnService(tx, poster, id, true);
        if (body.state_id !== undefined) {
          const [state] = await tx.$queryRawUnsafe<{ id: string }[]>(
            'SELECT id FROM public.state WHERE id = $1 AND deleted_at IS NULL',
            body.state_id,
          );
          if (!state) throw invalidField('state_id', MARKET_POST_MESSAGES.stateUnknown);
        }
        const today = todayUtc();
        // Going live with no end date: thirty days on the market.
        const goesLive = body.status === 'active' && canonicalStatus(current.status) !== 'active';
        if (goesLive && (body.available_until ?? current.available_until) == null) {
          body.available_until = defaultEndDate(
            null,
            body.available_from ?? current.available_from,
            today,
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
        const price = body.price_ssp !== undefined ? body.price_ssp : current.price_ssp;
        const unit = body.price_unit !== undefined ? body.price_unit : current.price_unit;
        const negotiable = body.negotiable ?? current.negotiable;
        if (price == null && !negotiable) {
          throw invalidField('price_ssp', MARKET_POST_MESSAGES.priceOrNegotiable);
        }
        if (price != null && unit == null) {
          throw invalidField('price_unit', MARKET_POST_MESSAGES.priceUnitRequired);
        }

        const sets: string[] = [];
        const values: unknown[] = [];
        const changed: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(body)) {
          if (value === undefined) continue;
          values.push(value);
          sets.push(`${key} = $${values.length}${CASTS[key] ?? ''}`);
          if (key !== 'contact_phone' && key !== 'description') changed[key] = value;
        }
        values.push(id);
        await tx.$executeRawUnsafe(
          `UPDATE public.service_listing SET ${sets.join(', ')}, updated_at = now()
            WHERE id = $${values.length}::uuid`,
          ...values,
        );
        const moved = body.status !== undefined && body.status !== current.status;
        await writeAudit(tx, {
          entityType: 'service_listing',
          entityId: id,
          actorType: poster.type,
          actorId: poster.id,
          action: moved ? 'listing.status_changed' : 'listing.updated',
          before:
            moved || endChanged
              ? { status: current.status, available_until: current.available_until }
              : null,
          after: changed,
        });
        // 2026-10-27: an edit of the content addresses an open correction request.
        await addressCorrections(tx, 'service_listing', id, sentKeys(body), {
          actorType: poster.type,
          actorId: poster.id,
        });
        return loadOwnService(tx, poster, id);
      });
      return ok(presentOwnService(row));
    },
  },
});
