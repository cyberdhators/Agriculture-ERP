import { FARMER_ROLE, farmerRequestAnswerSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { UUID_PATTERN, notifyOrganization } from '../../../../../lib/api/buyers';
import { notFound, unprocessable } from '../../../../../lib/api/errors';
import {
  INCOMING_COLUMNS,
  INCOMING_FROM,
  INCOMING_WHERE,
  presentIncoming,
  type IncomingRow,
} from '../../../../../lib/api/farmer-accounts';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { farmerScope } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/**
 * PATCH /api/farmer/requests/:id -- the farmer accepts or declines a buyer's
 * request. B14.
 *
 * Only a request on one of the farmer's own listings, and only one nobody has
 * answered yet. The buyer is notified either way. Accepting records the
 * farmer's intent to sell; the price and the handover are agreed between the
 * two directly, with no third party (CORWADO, 2026-10-07), so no order is
 * created here.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: [FARMER_ROLE],
    bodySchema: farmerRequestAnswerSchema,
    handler: async ({ auth, body, params }) => {
      const { farmerId } = farmerScope(auth);
      const id = params.id ?? '';
      if (!UUID_PATTERN.test(id)) throw notFound();
      const status = body.answer === 'accept' ? 'accepted' : 'rejected';

      await audited(prisma, async (tx) => {
        const [current] = await tx.$queryRawUnsafe<{ status: string; organization_id: string }[]>(
          `SELECT r.status::text AS status, r.organization_id
             FROM public.purchase_request r
             JOIN public.produce_listing pl ON pl.id = r.listing_id
            WHERE r.id = $2::uuid AND ${INCOMING_WHERE}
            FOR UPDATE OF r`,
          farmerId,
          id,
        );
        if (!current) throw notFound();
        if (current.status !== 'submitted' && current.status !== 'under_review') {
          throw unprocessable('request_already_answered');
        }
        await tx.$executeRawUnsafe(
          `UPDATE public.purchase_request
              SET status = $2::public.purchase_request_status, decision_note = $3,
                  decided_at = now(), updated_at = now()
            WHERE id = $1::uuid`,
          id,
          status,
          body.note ?? null,
        );
        const actor = { actorType: 'farmer' as const, actorId: farmerId };
        await writeAudit(tx, {
          entityType: 'purchase_request',
          entityId: id,
          ...actor,
          action: 'purchase_request.decided',
          before: { status: current.status },
          after: { status },
        });
        await notifyOrganization(
          tx,
          current.organization_id,
          status === 'accepted' ? 'request_accepted' : 'request_rejected',
          actor,
        );
      });

      const [row] = await prisma.$queryRawUnsafe<IncomingRow[]>(
        `SELECT ${INCOMING_COLUMNS} ${INCOMING_FROM} WHERE r.id = $2::uuid AND ${INCOMING_WHERE}`,
        farmerId,
        id,
      );
      return ok(presentIncoming(row!));
    },
  },
});
