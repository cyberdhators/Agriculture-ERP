import { parseSouthSudanMobile } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { ApiFailure } from '../../../../../lib/api/errors';
import { created, defineRoutes } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/listings/:id/contact-requests
 *
 * Deliverable (g): a buyer reaches a farmer. PUBLIC — the buyer has no account.
 * What they give at the moment of interest IS the record: name, phone, quantity,
 * message. The farmer's caseload officer calls both sides and records the
 * introduction. The farmer's phone number never leaves the programme.
 */

interface ContactRow {
  id: string;
  listing_id: string;
  farmer_id: string;
  buyer_name: string;
  buyer_phone: string;
  message: string | null;
  quantity: string | null;
  status: string;
  note: string | null;
  created_at: string;
  handled_at: string | null;
  handled_by: string | null;
}

const LIMITS = { nameMax: 80, messageMax: 300, quantityMax: 40 } as const;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    handler: async (ctx) => {
      const listingId = ctx.params.id;

      // --- Parse body manually (public route, no Zod bodySchema) ---
      let raw: unknown;
      try {
        raw = await ctx.request.clone().json();
      } catch {
        throw new ApiFailure(400, 'invalid_json', 'The request body is not valid JSON.');
      }

      if (!raw || typeof raw !== 'object') {
        throw new ApiFailure(400, 'invalid_input', 'Expected a JSON object.');
      }
      const input = raw as Record<string, unknown>;

      const buyerName = typeof input.buyer_name === 'string' ? input.buyer_name.trim() : '';
      if (buyerName.length < 2 || buyerName.length > LIMITS.nameMax) {
        throw new ApiFailure(400, 'invalid_input', 'buyer_name must be 2 to 80 characters.');
      }

      const phoneResult = parseSouthSudanMobile(
        typeof input.buyer_phone === 'string' ? input.buyer_phone : '',
      );
      if (!phoneResult.ok) {
        throw new ApiFailure(400, 'invalid_input', phoneResult.message);
      }
      const buyerPhone = phoneResult.value;

      const message =
        typeof input.message === 'string' && input.message.trim().length > 0
          ? input.message.trim()
          : null;
      if (message && message.length > LIMITS.messageMax) {
        throw new ApiFailure(
          400,
          'invalid_input',
          `message must be under ${LIMITS.messageMax} characters.`,
        );
      }

      const quantity =
        typeof input.quantity === 'string' && input.quantity.trim().length > 0
          ? input.quantity.trim()
          : null;
      if (quantity && quantity.length > LIMITS.quantityMax) {
        throw new ApiFailure(400, 'invalid_input', 'quantity must be under 40 characters.');
      }

      // --- Look up the listing ---
      const [listing] = await prisma.$queryRawUnsafe<{ id: string; farmer_id: string }[]>(
        `SELECT id, farmer_id FROM public.produce_listing
         WHERE id = $1::uuid AND deleted_at IS NULL AND status = 'listed'
         LIMIT 1`,
        listingId,
      );
      if (!listing) {
        throw new ApiFailure(404, 'not_found', 'That listing is not on the marketplace.');
      }

      // --- Insert and audit ---
      const row = await audited(prisma, async (tx) => {
        const rows = await tx.$queryRawUnsafe<ContactRow[]>(
          `INSERT INTO public.contact_request
             (listing_id, farmer_id, buyer_name, buyer_phone, message, quantity)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
           RETURNING id, listing_id, farmer_id, buyer_name, buyer_phone,
                     message, quantity, status::text AS status, note,
                     created_at::text AS created_at, handled_at::text AS handled_at,
                     handled_by`,
          listing.id,
          listing.farmer_id,
          buyerName,
          buyerPhone,
          message,
          quantity,
        );
        const inserted = rows[0]!;

        await writeAudit(tx, {
          entityType: 'contact_request',
          entityId: inserted.id,
          actorType: 'system',
          actorId: null,
          action: 'contact_request.created',
          after: {
            listing_id: inserted.listing_id,
          },
        });

        return inserted;
      });

      return created(row);
    },
  },
});
