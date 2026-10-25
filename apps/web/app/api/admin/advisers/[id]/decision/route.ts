import {
  ADVISER_DECISION_RULES,
  type AdviserApplicationStatus,
  adviserDecisionSchema,
  effectiveAdviserStatus,
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
import { notifyAccount } from '../../../../../../lib/api/notify';
import { requirePermission } from '../../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';
import { type AccountNotice } from '../../../../../../lib/farmer-notices';

/**
 * POST /api/admin/advisers/:id/decision { action, reason } -- a staff
 * decision on an adviser application (2026-10-24). ADMINISTRATOR ONLY, and
 * then `content.moderate`, as account suspension is.
 *
 *   request_clarification  submitted -> clarification_requested; the reason
 *                          IS the question the applicant sees
 *   approve                open -> approved; the provider gains the badge
 *   decline                open -> declined
 *   revoke                 approved | suspended -> revoked; the provider loses the badge
 *   suspend (2026-10-28)   approved -> suspended for suspend_days (1-365); the
 *                          badge is hidden until then, when it lapses by itself
 *   restore (2026-10-28)   suspended -> approved early; the badge shows again
 *
 * 2026-10-28: an approval records what the staff member checked (`checks`),
 * which the public profile shows as "what CORWADO checked". A suspension past
 * its end date counts as approved (effectiveAdviserStatus).
 *
 * In ONE transaction: the application, the provider's approved_at and
 * approved_application_id (approve sets both, revoke clears both), and one
 * audit row carrying the statuses and the recorded reason (as
 * account.suspended carries its reason). Account suspension is never read or
 * changed here, and the suspension routes never touch an approval: the two
 * are independent, so restoring an account does not restore a revocation.
 *
 * 2026-10-26 (CORWADO's acceptance test): the applicant is told, in the same
 * transaction, by one in-app notice with a fixed sentence (NOTICE below). The
 * question or the reason is never in the notice; it is on their Offer advice
 * page.
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
  suspend: 'adviser_approval.suspended',
  restore: 'adviser_approval.restored',
};

/** The notice each decision sends the applicant. Fixed sentences: lib/farmer-notices.ts. */
const NOTICE: Record<AdviserDecision, AccountNotice> = {
  request_clarification: 'adviser_clarification_requested',
  approve: 'adviser_approved',
  decline: 'adviser_declined',
  revoke: 'adviser_revoked',
  suspend: 'adviser_suspended',
  restore: 'adviser_restored',
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
          {
            id: string;
            status: AdviserApplicationStatus;
            suspended_until: Date | null;
            auth_user_id: string;
            provider_id: string;
          }[]
        >(
          `SELECT a.id, a.status, a.suspended_until, a.auth_user_id, a.provider_id
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
        // A lapsed suspension is an approval again (it may be suspended anew).
        const standing = effectiveAdviserStatus(
          current.status,
          current.suspended_until,
          Date.now(),
        );
        if (!(rule.from as readonly string[]).includes(standing)) {
          throw unprocessable('adviser_decision_not_allowed');
        }

        let suspendedUntil: Date | null = null;
        if (body.action === 'suspend') {
          suspendedUntil = new Date(Date.now() + (body.suspend_days ?? 1) * 24 * 60 * 60 * 1000);
          await tx.$executeRawUnsafe(
            `UPDATE public.adviser_application
                SET status = 'suspended', suspended_until = $2::timestamptz,
                    suspension_reason = $3, updated_at = now()
              WHERE id = $1::uuid`,
            id,
            suspendedUntil.toISOString(),
            body.reason,
          );
        } else if (body.action === 'restore') {
          await tx.$executeRawUnsafe(
            `UPDATE public.adviser_application
                SET status = 'approved', suspended_until = NULL, updated_at = now()
              WHERE id = $1::uuid`,
            id,
          );
        } else if (body.action === 'request_clarification') {
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
                    decided_at = now(), updated_at = now(), suspended_until = NULL,
                    verified_checks = CASE WHEN $2 = 'approved' THEN $5::text[]
                                           ELSE verified_checks END
              WHERE id = $1::uuid`,
            id,
            rule.to,
            body.reason,
            auth.principal.id,
            body.action === 'approve' ? (body.checks ?? []) : [],
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
          before: { status: standing },
          after: {
            status: rule.to,
            provider_id: current.provider_id,
            reason: body.reason,
            ...(body.action === 'approve' ? { checks: body.checks ?? [] } : {}),
            ...(suspendedUntil
              ? { suspended_until: suspendedUntil.toISOString(), days: body.suspend_days }
              : {}),
          },
        });

        await notifyAccount(tx, { authUserId: current.auth_user_id }, NOTICE[body.action], {
          actorType: auth.role,
          actorId: auth.principal.id,
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
