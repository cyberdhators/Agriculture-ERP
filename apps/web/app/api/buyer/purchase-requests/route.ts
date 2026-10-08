import {
  BUYER_MESSAGES,
  BUYER_ROLE,
  DEFAULT_LIMIT,
  ERROR_CODES,
  ERROR_MESSAGES,
  MAX_LIMIT,
  PURCHASE_REQUEST_STATUSES,
  buyerListFilterSchema,
  decodeCursor,
  encodeCursor,
  purchaseRequestInputSchema,
  zodErrorToApiError,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import {
  MARKET_BASE_WHERE,
  MARKET_FROM,
  REQUEST_COLUMNS,
  REQUEST_FROM,
  buyerActor,
  loadOwnRequest,
  notifyFarmerOfRequest,
  presentRequest,
  requireBrowse,
  requireVerified,
  checkRequestedItems,
  type RequestRow,
} from '../../../../lib/api/buyers';
import { ApiFailure, invalidCursor, unprocessable } from '../../../../lib/api/errors';
import { created, defineRoutes, paged } from '../../../../lib/api/route';
import { buyerScope } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * GET and POST /api/buyer/purchase-requests. B13, C-14B.11.
 *
 * A request belongs to the ORGANISATION, so two people buying for one company
 * see one history. The organisation is the session's, never the body's: the
 * input schema has no organisation field to send (C-14B.16).
 *
 * WHO MAY DO WHAT, by standing (C-14B.3):
 *   - any buyer reads their organisation's history, whatever its standing;
 *   - pending or under review: may save a DRAFT, may not submit;
 *   - verified: may submit;
 *   - rejected or suspended: may create nothing.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [BUYER_ROLE],
    handler: async ({ request, auth }) => {
      const scope = buyerScope(auth);
      const parsed = buyerListFilterSchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success) {
        const { body } = zodErrorToApiError(parsed.error);
        throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
      }
      const filter = parsed.data;
      let limit = DEFAULT_LIMIT;
      if (filter.limit !== undefined) {
        const n = Number(filter.limit);
        if (!Number.isInteger(n) || n < 1) throw invalidCursor();
        limit = Math.min(n, MAX_LIMIT);
      }

      const params: unknown[] = [scope.organizationId];
      const where = ['r.organization_id = $1::uuid', 'r.deleted_at IS NULL'];
      if (filter.status) {
        if (!(PURCHASE_REQUEST_STATUSES as readonly string[]).includes(filter.status)) {
          throw new ApiFailure(400, ERROR_CODES.invalidInput, ERROR_MESSAGES.invalidInput, {
            status: BUYER_MESSAGES.statusFilterUnknown,
          });
        }
        params.push(filter.status);
        where.push(`r.status = $${params.length}::public.purchase_request_status`);
      }
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(r.created_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<RequestRow[]>(
        `SELECT ${REQUEST_COLUMNS} ${REQUEST_FROM}
          WHERE ${where.join(' AND ')}
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(page.map(presentRequest), {
        cursor:
          hasMore && last
            ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
            : null,
        hasMore,
      });
    },
  },

  POST: {
    roles: [BUYER_ROLE],
    bodySchema: purchaseRequestInputSchema,
    handler: async ({ auth, body }) => {
      // A draft needs browsing standing; sending one needs verification.
      const scope = body.submit ? requireVerified(auth) : requireBrowse(auth);

      let category: string = body.category;
      let productName = body.product_name;
      if (body.listing_id) {
        // The listing must be one a buyer could see right now. Its own
        // category and product are what is stored, so a request cannot claim
        // to be for one thing while pointing at another.
        const [listing] = await prisma.$queryRawUnsafe<
          { category: string; product_name: string }[]
        >(
          `SELECT pl.category::text AS category, pl.product_name ${MARKET_FROM}
            WHERE ${MARKET_BASE_WHERE} AND pl.id = $1::uuid`,
          body.listing_id,
        );
        if (!listing) throw unprocessable('listing_not_available');
        if (body.submit) {
          await checkRequestedItems(
            prisma,
            scope.organizationId,
            [{ listing_id: body.listing_id, quantity: body.quantity, unit: body.unit }],
            () => 'quantity',
          );
        }
        category = listing.category;
        productName = listing.product_name;
      }

      const status = body.submit ? 'submitted' : 'draft';
      const id = await audited(prisma, async (tx) => {
        const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.purchase_request
             (organization_id, created_by, listing_id, category, product_name, quantity, unit,
              delivery_location, required_by, notes, status, submitted_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::public.listing_category, $5, $6,
                   $7::public.listing_unit, $8, $9::date, $10,
                   $11::public.purchase_request_status,
                   CASE WHEN $12::boolean THEN now() ELSE NULL END)
           RETURNING id`,
          scope.organizationId,
          scope.buyerId,
          body.listing_id ?? null,
          category,
          productName,
          body.quantity,
          body.unit,
          body.delivery_location,
          body.required_by ?? null,
          body.notes ?? null,
          status,
          status === 'submitted',
        );
        await writeAudit(tx, {
          entityType: 'purchase_request',
          entityId: row!.id,
          ...buyerActor(auth),
          action: 'purchase_request.created',
          after: {
            organization_id: scope.organizationId,
            listing_id: body.listing_id ?? null,
            category,
            product_name: productName,
            quantity: body.quantity,
            unit: body.unit,
            status,
          },
        });
        // B14: the farmer is told at once, on their dashboard.
        if (status === 'submitted') {
          await notifyFarmerOfRequest(tx, body.listing_id, buyerActor(auth));
        }
        return row!.id;
      });

      return created(presentRequest(await loadOwnRequest(prisma, scope.organizationId, id)));
    },
  },
});
