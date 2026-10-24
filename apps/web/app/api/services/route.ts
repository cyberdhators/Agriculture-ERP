import { randomUUID } from 'node:crypto';

import {
  BUYER_ROLE,
  ERROR_CODES,
  ERROR_MESSAGES,
  FARMER_ROLE,
  MARKET_POST_MESSAGES,
  decodeCursor,
  defaultEndDate,
  serviceFilterSchema,
  serviceListingSchema,
  servicePosterIssue,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../lib/api/audit';
import { ApiFailure, invalidCursor } from '../../../lib/api/errors';
import { loadSelf } from '../../../lib/api/farmer-accounts';
import {
  SERVICE_COLUMNS,
  SERVICE_FROM,
  SERVICE_MARKET_WHERE,
  cursorOf,
  invalidField,
  likePattern,
  loadOwnService,
  marketPoster,
  pageLimit,
  parseQuery,
  posterPhone,
  presentOwnService,
  presentService,
  todayUtc,
  type ServiceRow,
} from '../../../lib/api/market-posts';
import { created, defineRoutes, ok, paged } from '../../../lib/api/route';
import { prisma } from '../../../lib/db';

/**
 * /api/services -- service listings: tractor hire, transport, processing,
 * storage, other. LISTINGS LANE (2026-10-19), CORWADO's specification of 16
 * October 2026.
 *
 * GET is public: every active service whose end date has not passed, from a
 * farmer or buyer account that is live and not suspended, with search (q)
 * and filters (service type, state). Rows leave through presentService -- no
 * phone, no farmer or buyer id; the Verified badge is shown, never filtered on.
 *
 * POST is for any signed-in farmer or buyer account (2026-10-26, replacing
 * "owned by a farmer account for now": an institute, college, research body,
 * advisory organisation or independent adviser offers services on its own
 * initiative). The owner is the session's account, never the body. A farmer's
 * payam and state come from the farmer record; a buyer account names a state
 * from the list (no payam). With no end date, thirty days on the market.
 * Idempotent on a client-generated id (C-9).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async ({ request }) => {
      const filter = parseQuery(request, serviceFilterSchema);
      const limit = pageLimit(filter.limit);
      const params: unknown[] = [];
      const add = (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
      };
      const where = [SERVICE_MARKET_WHERE];
      if (filter.q) {
        const p = add(likePattern(filter.q));
        where.push(
          `(sl.title ILIKE ${p} ESCAPE '\\' OR sl.trading_name ILIKE ${p} ESCAPE '\\'
            OR sl.location ILIKE ${p} ESCAPE '\\' OR sl.description ILIKE ${p} ESCAPE '\\')`,
        );
      }
      if (filter.service_type) where.push(`sl.service_type = ${add(filter.service_type)}`);
      if (filter.state_id) where.push(`sl.state_id = ${add(filter.state_id)}`);
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        where.push(
          `(sl.updated_at, sl.id) < (${add(cursor.createdAt)}::timestamptz, ${add(cursor.id)}::uuid)`,
        );
      }
      const rows = await prisma.$queryRawUnsafe<ServiceRow[]>(
        `SELECT ${SERVICE_COLUMNS} ${SERVICE_FROM}
          WHERE ${where.join(' AND ')}
          ORDER BY sl.updated_at DESC, sl.id DESC
          LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(page.map(presentService), {
        cursor: hasMore && last ? cursorOf(last) : null,
        hasMore,
      });
    },
  },

  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: serviceListingSchema,
    handler: async ({ auth, body }) => {
      const poster = marketPoster(auth);
      const id = body.id ?? randomUUID();

      const [existing] = await prisma.$queryRawUnsafe<
        { farmer_id: string | null; buyer_id: string | null }[]
      >('SELECT farmer_id, buyer_id FROM public.service_listing WHERE id = $1::uuid', id);
      if (existing) {
        const mine =
          poster.type === 'farmer'
            ? existing.farmer_id === poster.id
            : existing.buyer_id === poster.id;
        if (!mine) throw new ApiFailure(409, ERROR_CODES.conflict, ERROR_MESSAGES.conflict);
        return ok(presentOwnService(await loadOwnService(prisma, poster, id)));
      }

      const issue = servicePosterIssue(poster.type, body, true);
      if (issue) throw invalidField(issue.field, issue.message);

      // Where the service is: the farmer record's payam and state, or the
      // state a buyer account chose (checked against the list), with no payam.
      let payamId: string | null = null;
      let stateId: string;
      let phone: string;
      if (poster.type === 'farmer') {
        const farmer = await loadSelf(prisma, poster.id);
        payamId = farmer.payam_id;
        stateId = farmer.state_id;
        phone = body.contact_phone ?? farmer.phone;
      } else {
        const [state] = await prisma.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM public.state WHERE id = $1 AND deleted_at IS NULL',
          body.state_id,
        );
        if (!state) throw invalidField('state_id', MARKET_POST_MESSAGES.stateUnknown);
        stateId = state.id;
        phone = body.contact_phone ?? (await posterPhone(prisma, poster));
      }

      const today = todayUtc();
      const availableUntil = defaultEndDate(body.available_until, body.available_from, today);
      if (availableUntil < body.available_from) {
        throw invalidField('available_until', MARKET_POST_MESSAGES.untilBeforeFrom);
      }
      if (body.status === 'active' && availableUntil < today) {
        throw invalidField('available_until', MARKET_POST_MESSAGES.dateInPast);
      }

      const row = await audited(prisma, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO public.service_listing
             (id, poster_type, farmer_id, buyer_id, trading_name, service_type, title,
              description, location, payam_id, state_id, available_from, available_until,
              availability_note, price_ssp, price_unit, negotiable, contact_phone, status,
              show_phone)
           VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11,
                   $12::date, $13::date, $14, $15, $16, $17, $18, $19, $20)`,
          id,
          poster.type,
          poster.type === 'farmer' ? poster.id : null,
          poster.type === 'buyer' ? poster.id : null,
          body.trading_name,
          body.service_type,
          body.title,
          body.description,
          body.location,
          payamId,
          stateId,
          body.available_from,
          availableUntil,
          body.availability_note ?? null,
          body.price_ssp ?? null,
          body.price_ssp == null ? null : (body.price_unit ?? null),
          body.negotiable,
          phone,
          body.status,
          body.show_phone,
        );
        await writeAudit(tx, {
          entityType: 'service_listing',
          entityId: id,
          actorType: poster.type,
          actorId: poster.id,
          action: 'listing.created',
          after: {
            kind: 'service_listing',
            poster_type: poster.type,
            title: body.title,
            service_type: body.service_type,
            state_id: stateId,
            status: body.status,
            available_until: availableUntil,
          },
        });
        return loadOwnService(tx, poster, id);
      });
      return created(presentOwnService(row));
    },
  },
});
