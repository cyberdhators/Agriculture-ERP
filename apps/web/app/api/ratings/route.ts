import { BUYER_ROLE, FARMER_ROLE, submitRatingSchema, type MyRatings } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../lib/api/audit';
import { unprocessable } from '../../../lib/api/errors';
import { actorOf, viewerOf } from '../../../lib/api/messaging';
import { notifyAccount } from '../../../lib/api/notify';
import {
  assertMayRate,
  dealForViewer,
  dealsToRate,
  ratingSummaryOf,
  rateeOf,
  receivedBy,
} from '../../../lib/api/ratings';
import { created, defineRoutes, ok } from '../../../lib/api/route';
import { prisma } from '../../../lib/db';

/**
 * /api/ratings -- ratings after a completed deal (2026-11-03, lane-trust; the
 * owner's approval). docs/DECISIONS.md, "Ratings after a completed deal".
 *
 * GET is the caller's side's own: the completed deals it may still rate, the
 * ratings it received (with whether each is reported or hidden), and its
 * public summary. For a person acting for an organisation (`inbox.read`),
 * the organisation's.
 *
 * POST rates the other side of one completed deal: only a party, only a
 * completed deal, once per side, within 30 days of completion, and not
 * between two people one of whom blocked the other (packages/shared
 * ratingRefusal). Acting for an organisation needs `inbox.reply`, as
 * answering for it does. The rated party is sent one notice, "You received a
 * new rating" -- never the stars, the comment or who gave it. Audited with
 * ids and the stars only; the comment never enters the log.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, request }) => {
      const viewer = await viewerOf(prisma, request, auth, 'inbox.read');
      const result: MyRatings = {
        to_rate: await dealsToRate(prisma, viewer),
        received: await receivedBy(prisma, viewer),
        summary: await ratingSummaryOf(prisma, rateeOf(viewer)),
      };
      return ok(result);
    },
  },
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: submitRatingSchema,
    handler: async ({ auth, body, request }) => {
      const viewer = await viewerOf(prisma, request, auth, 'inbox.reply');
      const rating = await audited(prisma, async (tx) => {
        const deal = await dealForViewer(tx, body.deal_kind, body.deal_id, viewer);
        await assertMayRate(tx, deal, new Date());
        const ratee = deal.ratee!;
        const [row] = await tx.$queryRawUnsafe<{ id: string; created_at: Date }[]>(
          `INSERT INTO public.deal_rating
             (deal_kind, deal_id, rater_side, rater_auth_user_id, rater_organization_id,
              ratee_auth_user_id, ratee_organization_id, stars, comment, completed_at)
           VALUES ($1, $2::uuid, $3, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8::smallint, $9, $10)
           ON CONFLICT ON CONSTRAINT deal_rating_once_per_side DO NOTHING
           RETURNING id, created_at`,
          deal.kind,
          deal.id,
          deal.side,
          viewer.person,
          viewer.org,
          ratee.authUserId,
          ratee.organizationId,
          body.stars,
          body.comment ?? null,
          deal.completedAt,
        );
        // Another send from the same side won the race.
        if (!row) throw unprocessable('rating_already_given');
        await writeAudit(tx, {
          entityType: 'deal_rating',
          entityId: row.id,
          ...actorOf(auth),
          action: 'rating.created',
          after: {
            deal_kind: deal.kind,
            deal_id: deal.id,
            side: deal.side,
            stars: body.stars,
            with_comment: body.comment !== undefined,
            ...(viewer.org ? { as_organization_id: viewer.org } : {}),
          },
        });
        const ref = { kind: 'rating' as const, id: row.id };
        if (ratee.authUserId) {
          await notifyAccount(
            tx,
            { authUserId: ratee.authUserId },
            'rating_received',
            actorOf(auth),
            ref,
          );
        } else {
          // An organisation is told through its members who read its inbox.
          const members = await tx.$queryRawUnsafe<{ auth_user_id: string }[]>(
            `SELECT auth_user_id FROM public.organization_member
              WHERE organization_id = $1::uuid AND status = 'active'
                AND (preset = 'administrator' OR 'inbox.read' = ANY (permissions))
              ORDER BY joined_at LIMIT 20`,
            ratee.organizationId,
          );
          for (const member of members) {
            await notifyAccount(
              tx,
              { authUserId: member.auth_user_id },
              'rating_received',
              actorOf(auth),
              ref,
            );
          }
        }
        return {
          id: row.id,
          deal_kind: deal.kind,
          deal_id: deal.id,
          stars: body.stars,
          comment: body.comment ?? null,
          created_at: row.created_at.toISOString(),
        };
      });
      return created(rating);
    },
  },
});
