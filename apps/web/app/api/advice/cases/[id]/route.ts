import {
  ADVICE_OUTCOMES_BY_SIDE,
  BUYER_ROLE,
  FARMER_ROLE,
  adviceCasePatchSchema,
} from '@agri-erp/shared';

import {
  loadCase,
  presentCase,
  sideOf,
  withdrawWaitingReferral,
} from '../../../../../lib/api/advice';
import { audited, writeAudit } from '../../../../../lib/api/audit';
import { unprocessable } from '../../../../../lib/api/errors';
import { checkId } from '../../../../../lib/api/market-posts';
import { actorOf, me } from '../../../../../lib/api/messaging';
import { noticeCaseChanged } from '../../../../../lib/api/notify';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * /api/advice/cases/:id -- one advice request (2026-10-22), for its two
 * participants and nobody else: anyone else, staff included, gets 404.
 *
 * GET returns it from the caller's side. The provider also sees what the
 * requester chose to share (their general place, and their phone if they
 * asked to be called or texted); the requester never sees anything of the
 * provider's beyond the public profile. The conversation itself is read
 * through /api/conversations/:id like any other.
 *
 * PATCH makes one change, named by `action`:
 *   start     the provider takes it up: open -> in progress
 *   close     either side closes it with an outcome -- the requester:
 *             resolved, closed unresolved or cancelled; the provider:
 *             referred or closed unresolved (ADVICE_OUTCOMES_BY_SIDE)
 *   feedback  the requester rates it, 1 to 5 with an optional comment,
 *             once it is closed, once
 * Closing also withdraws a referral still waiting for the requester's answer
 * (2026-10-25). GET's case carries its photos as read links that expire, and
 * its referral, for the two participants only.
 * Repeating a change already made returns the case as it is. A closed case
 * takes no other change. Audited with statuses and the rating, never the
 * question, a message or the comment.
 *
 * 2026-10-26 (CORWADO's acceptance test): start and close send the OTHER
 * participant one in-app notice with a fixed sentence (noticeCaseChanged).
 * Feedback sends none.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params }) => {
      const reader = me(auth);
      const row = await loadCase(prisma, checkId(params.id), reader);
      return ok(await presentCase(prisma, row, reader, true));
    },
  },

  PATCH: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: adviceCasePatchSchema,
    handler: async ({ auth, body, params }) => {
      const reader = me(auth);
      const id = checkId(params.id);
      const row = await audited(prisma, async (tx) => {
        const current = await loadCase(tx, id, reader, true);
        const side = sideOf(current, reader);
        const entity = { entityType: 'advice_case', entityId: current.id, ...actorOf(auth) };

        if (body.action === 'start') {
          if (side !== 'provider') throw unprocessable('advice_case_not_yours_to_change');
          if (current.status === 'in_progress') return current;
          if (current.status !== 'open') throw unprocessable('advice_case_closed');
          await tx.$queryRawUnsafe(
            `UPDATE public.advice_case SET status = 'in_progress', updated_at = now()
              WHERE id = $1::uuid`,
            current.id,
          );
          await writeAudit(tx, {
            ...entity,
            action: 'advice_case.status_changed',
            before: { status: current.status },
            after: { status: 'in_progress' },
          });
          // 2026-10-26: the other side is told the case changed; never how or why.
          await noticeCaseChanged(tx, current, side, actorOf(auth));
          return loadCase(tx, current.id, reader);
        }

        if (body.action === 'close') {
          const outcome = body.outcome!;
          if (current.status === 'closed') {
            if (current.outcome === outcome && current.closed_by === reader) return current;
            throw unprocessable('advice_case_closed');
          }
          if (!ADVICE_OUTCOMES_BY_SIDE[side].includes(outcome)) {
            throw unprocessable('advice_case_not_yours_to_change');
          }
          await tx.$queryRawUnsafe(
            `UPDATE public.advice_case
                SET status = 'closed', outcome = $2, closed_at = now(), closed_by = $3::uuid,
                    updated_at = now()
              WHERE id = $1::uuid`,
            current.id,
            outcome,
            reader,
          );
          await writeAudit(tx, {
            ...entity,
            action: 'advice_case.closed',
            before: { status: current.status },
            after: { status: 'closed', outcome, closed_by_side: side },
          });
          // 2026-10-25: a referral still waiting for the requester's answer
          // ends with the case; nothing was shared, so nothing is undone.
          await withdrawWaitingReferral(tx, current.id, entity);
          await noticeCaseChanged(tx, current, side, actorOf(auth));
          return loadCase(tx, current.id, reader);
        }

        // feedback
        if (side !== 'requester') throw unprocessable('advice_case_not_yours_to_change');
        if (current.status !== 'closed') throw unprocessable('advice_feedback_not_closed');
        if (current.feedback_rating !== null) {
          if (
            current.feedback_rating === body.rating &&
            current.feedback_comment === (body.comment ?? null)
          ) {
            return current;
          }
          throw unprocessable('advice_feedback_already_given');
        }
        await tx.$queryRawUnsafe(
          `UPDATE public.advice_case
              SET feedback_rating = $2, feedback_comment = $3, updated_at = now()
            WHERE id = $1::uuid`,
          current.id,
          body.rating,
          body.comment ?? null,
        );
        await writeAudit(tx, {
          ...entity,
          action: 'advice_case.feedback',
          after: { feedback_rating: body.rating, with_comment: body.comment != null },
        });
        return loadCase(tx, current.id, reader);
      });
      return ok(await presentCase(prisma, row, reader, true));
    },
  },
});
