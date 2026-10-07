import {
  canDecideRequest,
  requestDecisionSchema,
  type PurchaseRequestStatus,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { UUID_PATTERN, notifyOrganization, type BuyerNotice } from '../../../../../lib/api/buyers';
import { notFound, unprocessable } from '../../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * PATCH /api/admin/purchase-requests/:id -- a reviewer's decision on a
 * submitted request. Administrator only. B13, C-14B.11.
 *
 * The transition table in packages/shared decides what may follow what; a
 * draft and a cancelled request take no decision at all. The note, if any,
 * is shown to the buyer -- it is written for them.
 */
const NOTICE: Partial<Record<PurchaseRequestStatus, BuyerNotice>> = {
  under_review: 'request_under_review',
  accepted: 'request_accepted',
  rejected: 'request_rejected',
  partially_fulfilled: 'request_partially_fulfilled',
  fulfilled: 'request_fulfilled',
};

/** B14: always true. Kept as a named switch so the refusal reads as a decision, not dead code. */
const REQUESTS_ANSWERED_BY_FARMER = true as boolean;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: ['admin'],
    bodySchema: requestDecisionSchema,
    handler: async ({ auth, body, params }) => {
      const id = params.id ?? '';
      if (!UUID_PATTERN.test(id)) throw notFound();
      // B14 (the owner, 2026-10-07): "purchase requests are accepted by the
      // farmer, not CORWADO". The farmer answers on PATCH /api/farmer/requests/:id;
      // an administrator may read requests but never decide one.
      if (REQUESTS_ANSWERED_BY_FARMER) throw unprocessable('request_answered_by_farmer');
      const actor = { actorType: 'admin' as const, actorId: auth.principal.id };

      const row = await audited(prisma, async (tx) => {
        const [current] = await tx.$queryRawUnsafe<{ status: string; organization_id: string }[]>(
          `SELECT status::text AS status, organization_id FROM public.purchase_request
            WHERE id = $1::uuid AND deleted_at IS NULL FOR UPDATE`,
          id,
        );
        if (!current) throw notFound();
        const from = current.status as PurchaseRequestStatus;
        if (!canDecideRequest(from, body.status)) throw unprocessable('transition_not_allowed');

        const [updated] = await tx.$queryRawUnsafe<{ status: string; decided_at: Date }[]>(
          `UPDATE public.purchase_request
              SET status = $2::public.purchase_request_status, decision_note = $3,
                  decided_by = $4::uuid, decided_at = now(), updated_at = now()
            WHERE id = $1::uuid
            RETURNING status::text AS status, decided_at`,
          id,
          body.status,
          body.note ?? null,
          auth.principal.id,
        );
        await writeAudit(tx, {
          entityType: 'purchase_request',
          entityId: id,
          ...actor,
          action: 'purchase_request.decided',
          before: { status: from },
          after: { status: body.status },
        });
        const notice = NOTICE[body.status as PurchaseRequestStatus];
        if (notice) await notifyOrganization(tx, current.organization_id, notice, actor);
        return updated!;
      });

      return ok({ id, status: row.status, decided_at: row.decided_at.toISOString() });
    },
  },
});
