import { BUYER_ROLE, FARMER_ROLE, reportRatingSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../lib/api/errors';
import { checkId } from '../../../../../lib/api/market-posts';
import { actorOf, viewerOf } from '../../../../../lib/api/messaging';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/ratings/:id/report -- the RATED party reports an abusive rating
 * to the programme team (2026-11-03, lane-trust). The product-report reasons,
 * reused, and an optional note; once per rating. The rating stays as it is
 * until a moderator holding content.moderate decides (PATCH
 * /api/admin/ratings/:id). For an organisation, a member holding
 * `inbox.reply` reports for it. A rating that does not exist is 404; one
 * about someone else is `rating_not_yours`. The note never enters the log.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: reportRatingSchema,
    handler: async ({ auth, body, params, request }) => {
      const viewer = await viewerOf(prisma, request, auth, 'inbox.reply');
      const id = checkId(params.id);
      const result = await audited(prisma, async (tx) => {
        const [row] = await tx.$queryRawUnsafe<
          {
            id: string;
            ratee_auth_user_id: string | null;
            ratee_organization_id: string | null;
            reported_at: Date | null;
          }[]
        >(
          `SELECT id, ratee_auth_user_id, ratee_organization_id, reported_at
             FROM public.deal_rating WHERE id = $1::uuid AND deleted_at IS NULL FOR UPDATE`,
          id,
        );
        if (!row) throw notFound();
        const mine =
          viewer.org === null
            ? row.ratee_organization_id === null && row.ratee_auth_user_id === viewer.person
            : row.ratee_organization_id === viewer.org;
        if (!mine) throw unprocessable('rating_not_yours');
        if (row.reported_at) throw unprocessable('rating_already_reported');
        await tx.$queryRawUnsafe(
          `UPDATE public.deal_rating
              SET reported_at = now(), report_reason = $2::public.report_reason,
                  report_note = $3, updated_at = now()
            WHERE id = $1::uuid`,
          row.id,
          body.reason,
          body.note ?? null,
        );
        await writeAudit(tx, {
          entityType: 'deal_rating',
          entityId: row.id,
          ...actorOf(auth),
          action: 'rating.reported',
          before: { reported: false },
          after: {
            reported: true,
            reason: body.reason,
            ...(viewer.org ? { as_organization_id: viewer.org } : {}),
          },
        });
        return { id: row.id, reported: true };
      });
      return ok(result);
    },
  },
});
