import {
  BUYER_ROLE,
  FARMER_ROLE,
  memberMay,
  orgAdviceActionSchema,
  orgAdviceDecision,
  type AuditAction,
  type OrgAdviceActionInput,
} from '@agri-erp/shared';

import { withdrawWaitingReferral } from '../../../../../../../lib/api/advice';
import { audited, writeAudit } from '../../../../../../../lib/api/audit';
import { forbidden, notFound, unprocessable } from '../../../../../../../lib/api/errors';
import { checkId } from '../../../../../../../lib/api/market-posts';
import { noticeCaseChanged, notifyAccount } from '../../../../../../../lib/api/notify';
import {
  caseState,
  loadOrgCase,
  presentOrgCase,
  requireHandler,
} from '../../../../../../../lib/api/organization-advice';
import {
  actorFor,
  asMember,
  personOf,
  type MemberRow,
} from '../../../../../../../lib/api/organizations';
import { defineRoutes, ok } from '../../../../../../../lib/api/route';
import { prisma } from '../../../../../../../lib/db';

/**
 * POST /api/organizations/:id/advice-cases/:caseId/action -- one change to a
 * request in the organisation's shared advice inbox (2026-10-28):
 *
 *   claim    take an unassigned request yourself (assigned and accepted)
 *   assign   an administrator gives it to a member holding advisory.handle
 *            (`member_id` is that member's organisation_member id)
 *   accept   the member it was given to takes it up
 *   release  the assignee, or an administrator, hands it back
 *   close    the accepted assignee, or an administrator, closes it with the
 *            provider's outcome: referred or closed unresolved
 *
 * Decided by orgAdviceDecision (packages/shared), the one place the rules
 * live. Handlers only, on an open organisation; the case row is locked for
 * the change. A repeat of a change already made returns the case as it is.
 *
 * Audited in the same transaction as the change: advice_case.assigned,
 * .accepted, .released or .closed, with statuses and member ids, never the
 * question. The requester is told (one fixed-sentence notice) when the case
 * is taken up or closed; a member given a case is told it is theirs.
 */
const notHandler = () => forbidden();

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: orgAdviceActionSchema,
    handler: async ({ auth, body: raw, params }) => {
      const body = raw as OrgAdviceActionInput;
      const person = personOf(auth);
      const organizationId = checkId(params.id);
      const caseId = checkId(params.caseId);
      const actor = actorFor(auth);

      const result = await audited(prisma, async (tx) => {
        const { organization, caller } = await requireHandler(tx, organizationId, person, {
          open: true,
        });
        const current = await loadOrgCase(tx, organization.id, caseId, true);

        // The member an administrator assigns to: active in THIS organisation.
        let target: { person: string; handles: boolean; member: MemberRow } | null = null;
        if (body.action === 'assign') {
          const [member] = await tx.$queryRawUnsafe<MemberRow[]>(
            `SELECT m.id, m.organization_id, m.auth_user_id, m.preset, m.permissions, m.status,
                    m.show_on_profile, m.public_title, m.joined_at, m.ended_at, m.end_reason
               FROM public.organization_member m
              WHERE m.id = $1::uuid AND m.organization_id = $2::uuid AND m.status = 'active'`,
            body.member_id,
            organization.id,
          );
          target = member
            ? {
                person: member.auth_user_id,
                handles: memberMay(asMember(member), 'advisory.handle'),
                member,
              }
            : null;
        }

        const decision = orgAdviceDecision({
          action: body.action,
          caller,
          current: caseState(current),
          target,
        });
        if (!decision.ok) {
          if (decision.rule === 'forbidden') throw notHandler();
          throw unprocessable(decision.rule);
        }
        if (body.action === 'close' && current.status === 'closed') {
          // Repeating a close: the same outcome is the same change; another is refused.
          if (current.outcome !== body.outcome) throw unprocessable('advice_case_closed');
          return { row: current, caller };
        }
        if (!decision.changed) return { row: current, caller };

        const next = decision.next;
        const newAssignee = next.assignee !== current.assigned_auth_user_id;
        const entity = { entityType: 'advice_case', entityId: current.id, ...actor };

        if (body.action === 'close') {
          await tx.$queryRawUnsafe(
            `UPDATE public.advice_case
                SET status = 'closed', outcome = $2, closed_at = now(), closed_by = $3::uuid,
                    updated_at = now()
              WHERE id = $1::uuid`,
            current.id,
            body.outcome,
            person,
          );
        } else {
          await tx.$queryRawUnsafe(
            `UPDATE public.advice_case
                SET status = $2,
                    assigned_auth_user_id = $3::uuid,
                    assigned_by = CASE WHEN $3::uuid IS NULL THEN NULL
                                       WHEN $5 THEN $4::uuid ELSE assigned_by END,
                    assigned_at = CASE WHEN $3::uuid IS NULL THEN NULL
                                       WHEN $5 THEN now() ELSE assigned_at END,
                    accepted_at = CASE WHEN $6 THEN COALESCE(accepted_at, now()) ELSE NULL END,
                    updated_at = now()
              WHERE id = $1::uuid`,
            current.id,
            next.status,
            next.assignee,
            person,
            newAssignee,
            next.accepted,
          );
        }

        const ACTION: Record<OrgAdviceActionInput['action'], AuditAction> = {
          claim: 'advice_case.assigned',
          assign: 'advice_case.assigned',
          accept: 'advice_case.accepted',
          release: 'advice_case.released',
          close: 'advice_case.closed',
        };
        await writeAudit(tx, {
          ...entity,
          action: ACTION[body.action],
          before: {
            status: current.status,
            assigned: current.assigned_auth_user_id !== null,
            accepted: current.accepted_at !== null,
          },
          after: {
            status: next.status,
            organization_id: organization.id,
            ...(body.action === 'assign' && target ? { assigned_member_id: target.member.id } : {}),
            ...(body.action === 'claim' ? { assigned_to: 'self' } : {}),
            accepted: next.accepted,
            ...(body.action === 'close'
              ? { outcome: body.outcome, closed_by_side: 'provider' }
              : {}),
          },
        });

        if (body.action === 'close') {
          await withdrawWaitingReferral(tx, current.id, actor);
        }
        // The requester learns the case was taken up or closed; never by whom.
        if (body.action === 'close' || (current.status === 'open' && next.status !== 'open')) {
          await noticeCaseChanged(tx, current, 'provider', actor);
        }
        // A member given a case by someone else is told it is theirs.
        if (body.action === 'assign' && target && target.person !== person) {
          await notifyAccount(tx, { authUserId: target.person }, 'advice_work_updated', actor);
        }

        return { row: await loadOrgCase(tx, organization.id, current.id), caller };
      });

      if (!result.row) throw notFound(); // unreachable: just read
      return ok(presentOrgCase(result.row, result.caller));
    },
  },
});
