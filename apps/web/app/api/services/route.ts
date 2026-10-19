import { randomUUID } from 'node:crypto';

import {
  ERROR_CODES,
  ERROR_MESSAGES,
  FARMER_ROLE,
  MARKET_POST_MESSAGES,
  decodeCursor,
  defaultEndDate,
  serviceFilterSchema,
  serviceListingSchema,
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
  pageLimit,
  parseQuery,
  presentOwnService,
  presentService,
  todayUtc,
  type ServiceRow,
} from '../../../lib/api/market-posts';
import { created, defineRoutes, ok, paged } from '../../../lib/api/route';
import { farmerScope } from '../../../lib/api/scope';
import { prisma } from '../../../lib/db';

/**
 * /api/services -- service listings: tractor hire, transport, processing,
 * storage, other. LISTINGS LANE (2026-10-19), CORWADO's specification of 16
 * October 2026.
 *
 * GET is public: every active service whose end date has not passed, from a
 * farmer whose record is live, with search (q) and filters (service type,
 * state). Rows leave through presentService -- no phone, no farmer id; the
 * "Verified farmer" badge is shown, never filtered on.
 *
 * POST is a farmer's own (owned by a farmer account for now, the owner,
 * 2026-10-19). The owner, payam and state come from the session's farmer
 * record, never the body. With no end date, thirty days on the market.
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
    roles: [FARMER_ROLE],
    bodySchema: serviceListingSchema,
    handler: async ({ auth, body }) => {
      const { farmerId } = farmerScope(auth);
      const id = body.id ?? randomUUID();

      const [existing] = await prisma.$queryRawUnsafe<{ farmer_id: string }[]>(
        'SELECT farmer_id FROM public.service_listing WHERE id = $1::uuid',
        id,
      );
      if (existing) {
        if (existing.farmer_id !== farmerId) {
          throw new ApiFailure(409, ERROR_CODES.conflict, ERROR_MESSAGES.conflict);
        }
        return ok(presentOwnService(await loadOwnService(prisma, farmerId, id)));
      }

      const farmer = await loadSelf(prisma, farmerId);
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
             (id, farmer_id, trading_name, service_type, title, description, location,
              payam_id, state_id, available_from, available_until, availability_note,
              price_ssp, price_unit, negotiable, contact_phone, status, show_phone)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10::date, $11::date,
                   $12, $13, $14, $15, $16, $17, $18)`,
          id,
          farmerId,
          body.trading_name,
          body.service_type,
          body.title,
          body.description,
          body.location,
          farmer.payam_id,
          farmer.state_id,
          body.available_from,
          availableUntil,
          body.availability_note ?? null,
          body.price_ssp ?? null,
          body.price_ssp == null ? null : (body.price_unit ?? null),
          body.negotiable,
          body.contact_phone ?? farmer.phone,
          body.status,
          body.show_phone,
        );
        await writeAudit(tx, {
          entityType: 'service_listing',
          entityId: id,
          actorType: 'farmer',
          actorId: farmerId,
          action: 'listing.created',
          after: {
            kind: 'service_listing',
            title: body.title,
            service_type: body.service_type,
            status: body.status,
            available_until: availableUntil,
          },
        });
        return loadOwnService(tx, farmerId, id);
      });
      return created(presentOwnService(row));
    },
  },
});
