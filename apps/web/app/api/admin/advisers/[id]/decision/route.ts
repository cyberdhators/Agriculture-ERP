import {
  ADVISER_DECISION_RULES,
  adviserDecisionSchema,
  type AdviserDecision,
  type AdviserDecisionInput,
  type AuditAction,
} from '@agri-erp/shared';

import {
  STAFF_APPLICATION_SELECT,
  presentStaffApplication,
  type StaffApplicationRow,
} from '../../../../../../lib/api/adviser-approval';
import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../../lib/api/errors';
import { checkId } from '../../../../../../lib/api/market-posts';
import { requirePermission } from '../../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';

/**
 * POST /api/admin/advisers/:id/decision { action, reason } -- a staff
 * decision on an adviser application (2026-10-24). ADMINISTRATOR ONLY, and
 * then `content.moderate`, as account suspension is.
 *
 *   request_clarification  submitted -> clarification_requested; the reason
 *                          IS the question the applicant sees
 *   approve                open -> approved; the provider gains the badge
 *   decline                open -> declined
 *   revoke                 approved -> revoked; the provider loses the badge
 *
 * In ONE transaction: the application, the provider's approved_at and
 * approved_application_id (approve sets both, revoke clears both), and one
 * audit row carrying the statuses and the recorded reason (as
 * account.suspended carries its reason). Account suspension is never read or
 * changed here, and the suspension routes never touch an approval: the two
 * are independent, so restoring an account does not restore a revocation.
 *
 * A staff member may not decide on an application made from their own
 * sign-in. Staff accounts are not farmers or buyers today, so this cannot
 * arise; it is checked anyway, by sign-in id.
 */
const AUDIT_ACTION: Record<AdviserDecision, AuditAction> = {
  request_clarification: 'adviser_application.clarification_requested',
  approve: 'adviser_application.approved',
  decline: 'adviser_application.declined',
  revoke: 'adviser_approval.revoked',
};

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin'],
    bodySchema: adviserDecisionSchema,
    handler: async ({ auth, body: raw, params }) => {
      await requirePermission(auth, 'content.moderate');
      const body = raw as AdviserDecisionInput;
      const id = checkId(params.id);
      const rule = ADVISER_DECISION_RULES[body.action];

      const row = await audited(prisma, async (tx) => {
        // Lock the application and its provider, in that order, every time.
        const [current] = await tx.$queryRawUnsafe<
          { id: string; status: string; auth_user_id: string; provider_id: string }[]
        >(
          `SELECT a.id, a.status, a.auth_user_id, a.provider_id
             FROM public.adviser_application a
            WHERE a.id = $1::uuid AND a.deleted_at IS NULL
            FOR UPDATE`,
          id,
        );
        if (!current) throw notFound();
        const [provider] = await tx.$queryRawUnsafe<
          { approved_at: Date | null; approved_application_id: string | null }[]
        >(
          `SELECT approved_at, approved_application_id FROM public.advice_provider
            WHERE id = $1::uuid AND deleted_at IS NULL
            FOR UPDATE`,
          current.provider_id,
        );
        if (!provider) throw notFound();

        if (current.auth_user_id === auth.principal.authUserId) {
          throw unprocessable('adviser_own_application');
        }
        if (!(rule.from as readonly string[]).includes(current.status)) {
          throw unprocessable('adviser_decision_not_allowed');
        }

        if (body.action === 'request_clarification') {
          await tx.$executeRawUnsafe(
            `UPDATE public.adviser_application
                SET status = 'clarification_requested', clarification_request = $2,
                    applicant_reply = NULL, updated_at = now()
              WHERE id = $1::uuid`,
            id,
            body.reason,
          );
        } else {
          if (body.action === 'approve' && provider.approved_at !== null) {
            throw unprocessable('adviser_decision_not_allowed');
          }
          await tx.$executeRawUnsafe(
            `UPDATE public.adviser_application
                SET status = $2, decision_reason = $3, decided_by = $4::uuid,
                    decided_at = now(), updated_at = now()
              WHERE id = $1::uuid`,
            id,
            rule.to,
            body.reason,
            auth.principal.id,
          );
          if (body.action === 'approve') {
            await tx.$executeRawUnsafe(
              `UPDATE public.advice_provider
                  SET approved_at = now(), approved_application_id = $2::uuid
                WHERE id = $1::uuid`,
              current.provider_id,
              id,
            );
          } else if (body.action === 'revoke') {
            await tx.$executeRawUnsafe(
              `UPDATE public.advice_provider
                  SET approved_at = NULL, approved_application_id = NULL
                WHERE id = $1::uuid AND approved_application_id = $2::uuid`,
              current.provider_id,
              id,
            );
          }
        }

        await writeAudit(tx, {
          entityType: 'adviser_application',
          entityId: id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: AUDIT_ACTION[body.action],
          before: { status: current.status },
          after: { status: rule.to, provider_id: current.provider_id, reason: body.reason },
        });

        const [fresh] = await tx.$queryRawUnsafe<StaffApplicationRow[]>(
          `${STAFF_APPLICATION_SELECT} WHERE a.id = $1::uuid`,
          id,
        );
        return fresh;
      });

      if (!row) throw notFound(); // unreachable: just written
      return ok(presentStaffApplication(row));
    },
  },
});
