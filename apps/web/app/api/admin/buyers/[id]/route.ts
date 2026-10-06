import {
  buyerVerificationDecisionSchema,
  canMoveBuyer,
  type BuyerAccountType,
  type BuyerVerificationStatus,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import {
  NOTICE_FOR_STANDING,
  UUID_PATTERN,
  notifyOrganization,
} from '../../../../../lib/api/buyers';
import { notFound, unprocessable } from '../../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * PATCH /api/admin/buyers/:id -- an administrator decides an organisation's
 * standing. B13, C-14B.3.
 *
 * The ONLY writer of verification_status. A buyer has no route that touches
 * it, so a buyer cannot approve themselves (C-14B.16). Each move must be one
 * the transition table allows, and each one is audited under its own key and
 * sends the organisation a fixed notice.
 *
 * Suspension takes effect on the buyer's very next request: requireRole reads
 * the standing every time, so there is no session to revoke.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: ['admin'],
    bodySchema: buyerVerificationDecisionSchema,
    handler: async ({ auth, body, params }) => {
      const id = params.id ?? '';
      if (!UUID_PATTERN.test(id)) throw notFound();

      const result = await audited(prisma, async (tx) => {
        const [current] = await tx.$queryRawUnsafe<
          { verification_status: string; account_type: BuyerAccountType }[]
        >(
          `SELECT verification_status::text AS verification_status, account_type::text AS account_type
             FROM public.buyer_organization WHERE id = $1::uuid AND deleted_at IS NULL FOR UPDATE`,
          id,
        );
        if (!current) throw notFound();
        const from = current.verification_status as BuyerVerificationStatus;
        // The kind matters: an individual is never "verified" (nobody reviewed
        // them) and a business is never exempted from review.
        if (!canMoveBuyer(from, body.status, current.account_type)) {
          throw unprocessable('transition_not_allowed');
        }

        const [row] = await tx.$queryRawUnsafe<
          {
            verification_status: string;
            verification_note: string | null;
            verified_at: Date | null;
          }[]
        >(
          `UPDATE public.buyer_organization
              SET verification_status = $2::public.buyer_verification_status,
                  verification_note = $3,
                  verified_at = CASE WHEN $4::boolean THEN now() ELSE verified_at END,
                  verified_by = CASE WHEN $4::boolean THEN $5::uuid ELSE verified_by END,
                  updated_at = now()
            WHERE id = $1::uuid
            RETURNING verification_status::text AS verification_status, verification_note, verified_at`,
          id,
          body.status,
          body.note ?? null,
          body.status === 'verified',
          auth.principal.id,
        );
        const actor = { actorType: 'admin' as const, actorId: auth.principal.id };
        await writeAudit(tx, {
          entityType: 'buyer_organization',
          entityId: id,
          ...actor,
          action: 'buyer_organization.verification_changed',
          before: { verification_status: from },
          after: { verification_status: body.status },
        });
        const notice = NOTICE_FOR_STANDING[body.status as BuyerVerificationStatus];
        if (notice) await notifyOrganization(tx, id, notice, actor);
        return row!;
      });

      return ok({
        id,
        verification_status: result.verification_status,
        verification_note: result.verification_note,
        verified_at: result.verified_at?.toISOString() ?? null,
      });
    },
  },
});
