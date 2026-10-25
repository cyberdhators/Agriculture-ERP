import { randomUUID } from 'node:crypto';

import {
  BUYER_ROLE,
  ERROR_CODES,
  ERROR_MESSAGES,
  FARMER_ROLE,
  MARKET_POST_MESSAGES,
  buyingRequestFilterSchema,
  buyingRequestSchema,
  decodeCursor,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../lib/api/audit';
import { ApiFailure, invalidCursor } from '../../../lib/api/errors';
import {
  BUYING_REQUEST_COLUMNS,
  BUYING_REQUEST_FROM,
  BUYING_REQUEST_MARKET_WHERE,
  OWN_BUYING_REQUEST_COLUMNS,
  cursorOf,
  invalidField,
  likePattern,
  loadOwnBuyingRequest,
  marketPoster,
  pageLimit,
  parseQuery,
  posterPhone,
  presentBuyingRequest,
  presentOwnBuyingRequest,
  todayUtc,
  type BuyingRequestRow,
} from '../../../lib/api/market-posts';
import { created, defineRoutes, ok, paged } from '../../../lib/api/route';
import { prisma } from '../../../lib/db';
import { refuseArchivedChoice } from '../../../lib/api/settings';

/**
 * /api/buying-requests -- "I need X of Y in Z by date". LISTINGS LANE
 * (2026-10-19), CORWADO's specification of 16 October 2026.
 *
 * GET is public: the market shows every active buying request whose date has
 * not passed, newest change first, with search (q) and filters (category,
 * state, poster farmer/buyer). Each row leaves through presentBuyingRequest --
 * no phone, no farmer or buyer id, no legal name. A signed-in farmer or buyer
 * reads the poster's phone through ./[id]/contact.
 *
 * POST is for any signed-in farmer or buyer account. The poster is the
 * session's account (marketPoster), never a field of the body. NOT a
 * purchase_request: those go to one listing and are unchanged.
 *
 * Idempotent on a client-generated id (C-9), like every record a phone may
 * send twice: the same id from the same poster returns what was saved.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async ({ request }) => {
      const filter = parseQuery(request, buyingRequestFilterSchema);
      const limit = pageLimit(filter.limit);
      const params: unknown[] = [];
      const add = (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
      };
      const where = [BUYING_REQUEST_MARKET_WHERE];
      if (filter.q) {
        const p = add(likePattern(filter.q));
        where.push(
          `(br.product_name ILIKE ${p} ESCAPE '\\' OR br.display_name ILIKE ${p} ESCAPE '\\'
            OR br.location ILIKE ${p} ESCAPE '\\' OR br.description ILIKE ${p} ESCAPE '\\')`,
        );
      }
      if (filter.category)
        where.push(`br.category = ${add(filter.category)}::public.listing_category`);
      if (filter.state_id) where.push(`br.state_id = ${add(filter.state_id)}`);
      if (filter.poster) where.push(`br.poster_type = ${add(filter.poster)}`);
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        where.push(
          `(br.updated_at, br.id) < (${add(cursor.createdAt)}::timestamptz, ${add(cursor.id)}::uuid)`,
        );
      }
      const rows = await prisma.$queryRawUnsafe<BuyingRequestRow[]>(
        `SELECT ${BUYING_REQUEST_COLUMNS} ${BUYING_REQUEST_FROM}
          WHERE ${where.join(' AND ')}
          ORDER BY br.updated_at DESC, br.id DESC
          LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(page.map(presentBuyingRequest), {
        cursor: hasMore && last ? cursorOf(last) : null,
        hasMore,
      });
    },
  },

  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: buyingRequestSchema,
    handler: async ({ auth, body }) => {
      const poster = marketPoster(auth);
      const id = body.id ?? randomUUID();

      const [existing] = await prisma.$queryRawUnsafe<
        { farmer_id: string | null; buyer_id: string | null }[]
      >('SELECT farmer_id, buyer_id FROM public.buying_request WHERE id = $1::uuid', id);
      if (existing) {
        const mine =
          poster.type === 'farmer'
            ? existing.farmer_id === poster.id
            : existing.buyer_id === poster.id;
        if (!mine) throw new ApiFailure(409, ERROR_CODES.conflict, ERROR_MESSAGES.conflict);
        return ok(presentOwnBuyingRequest(await loadOwnBuyingRequest(prisma, poster, id)));
      }

      // 2026-10-27 (settings phase 2): no archived category or unit on a new request.
      await refuseArchivedChoice(body);
      if (body.needed_by < todayUtc()) {
        throw invalidField('needed_by', MARKET_POST_MESSAGES.dateInPast);
      }
      const [state] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        'SELECT id FROM public.state WHERE id = $1 AND deleted_at IS NULL',
        body.state_id,
      );
      if (!state) throw invalidField('state_id', MARKET_POST_MESSAGES.stateUnknown);
      const phone = body.contact_phone ?? (await posterPhone(prisma, poster));

      const row = await audited(prisma, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO public.buying_request
             (id, poster_type, farmer_id, buyer_id, display_name, category, product_name,
              quantity, unit, state_id, location, needed_by, price_ssp, price_per, negotiable,
              delivery_terms, description, contact_phone, status, show_phone)
           VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6::public.listing_category, $7,
                   $8, $9::public.listing_unit, $10, $11, $12::date, $13,
                   $14::public.listing_unit, $15, $16, $17, $18, $19, $20)`,
          id,
          poster.type,
          poster.type === 'farmer' ? poster.id : null,
          poster.type === 'buyer' ? poster.id : null,
          body.display_name,
          body.category,
          body.product_name,
          body.quantity,
          body.unit,
          body.state_id,
          body.location,
          body.needed_by,
          body.price_ssp ?? null,
          body.price_ssp == null ? null : (body.price_per ?? null),
          body.negotiable,
          body.delivery_terms ?? null,
          body.description ?? null,
          phone,
          body.status,
          body.show_phone,
        );
        await writeAudit(tx, {
          entityType: 'buying_request',
          entityId: id,
          actorType: poster.type,
          actorId: poster.id,
          action: 'listing.created',
          after: {
            kind: 'buying_request',
            product_name: body.product_name,
            category: body.category,
            quantity: body.quantity,
            needed_by: body.needed_by,
            status: body.status,
          },
        });
        const [saved] = await tx.$queryRawUnsafe<(BuyingRequestRow & { contact_phone: string })[]>(
          `SELECT ${OWN_BUYING_REQUEST_COLUMNS} ${BUYING_REQUEST_FROM} WHERE br.id = $1::uuid`,
          id,
        );
        return saved!;
      });
      return created(presentOwnBuyingRequest(row));
    },
  },
});
