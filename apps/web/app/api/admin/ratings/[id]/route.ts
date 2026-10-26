import { moderateRatingSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../lib/api/errors';
import { checkId } from '../../../../../lib/api/market-posts';
import { requirePermission } from '../../../../../lib/api/permissions';
import { MODERATION_RATING_SELECT, presentModerationRating } from '../../../../../lib/api/ratings';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/**
 * PATCH /api/admin/ratings/:id -- a moderator's decision on one rating
 * (2026-11-03, lane-trust). Staff holding content.moderate; read-only staff
 * never write.
 *
 *   hide            takes it off every public profile and out of the
 *                   average, with a reason (required). Soft: the row stays.
 *   restore         shows a hidden rating again.
 *   dismiss_report  closes the rated party's report and leaves the rating shown.
 *
 * A hidden rating leaves the open-reports queue. The reason is kept on the rating and
 * in the audit row (a staff reason, not a user's words); the comment never
 * enters the log.
 */
type Row = Parameters<typeof presentModerationRating>[0];

const load = async (id: string): Promise<Row> => {
  const [row] = await prisma.$queryRawUnsafe<Row[]>(
    `${MODERATION_RATING_SELECT} WHERE r.id = $1::uuid AND r.deleted_at IS NULL`,
    id,
  );
  if (!row) throw notFound();
  return row;
};

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: ['admin', 'supervisor'],
    bodySchema: moderateRatingSchema,
    handler: async ({ auth, body, params }) => {
      await requirePermission(auth, 'content.moderate');
      requireWriter(auth);
      const id = checkId(params.id);
      await audited(prisma, async (tx) => {
        const [row] = await tx.$queryRawUnsafe<
          { id: string; hidden_at: Date | null; reported_at: Date | null }[]
        >(
          `SELECT id, hidden_at, reported_at FROM public.deal_rating
            WHERE id = $1::uuid AND deleted_at IS NULL FOR UPDATE`,
          id,
        );
        if (!row) throw notFound();
        const before = { hidden: row.hidden_at !== null, reported: row.reported_at !== null };
        if (body.action === 'hide') {
          if (row.hidden_at) throw unprocessable('rating_already_hidden');
          await tx.$queryRawUnsafe(
            `UPDATE public.deal_rating
                SET hidden_at = now(), hidden_by = $2::uuid, hidden_reason = $3, updated_at = now()
              WHERE id = $1::uuid`,
            row.id,
            auth.principal.id,
            body.reason!,
          );
        } else if (body.action === 'restore') {
          if (!row.hidden_at) throw unprocessable('rating_not_hidden');
          await tx.$queryRawUnsafe(
            `UPDATE public.deal_rating
                SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL, updated_at = now()
              WHERE id = $1::uuid`,
            row.id,
          );
        } else {
          if (!row.reported_at) throw unprocessable('rating_no_report');
          await tx.$queryRawUnsafe(
            `UPDATE public.deal_rating
                SET reported_at = NULL, report_reason = NULL, report_note = NULL, updated_at = now()
              WHERE id = $1::uuid`,
            row.id,
          );
        }
        await writeAudit(tx, {
          entityType: 'deal_rating',
          entityId: row.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action:
            body.action === 'hide'
              ? 'rating.hidden'
              : body.action === 'restore'
                ? 'rating.restored'
                : 'rating.report_dismissed',
          before,
          after: {
            hidden:
              body.action === 'hide' ? true : body.action === 'restore' ? false : before.hidden,
            reported: body.action === 'dismiss_report' ? false : before.reported,
            ...(body.action === 'hide' ? { reason: body.reason } : {}),
          },
        });
      });
      return ok(presentModerationRating(await load(id)));
    },
  },
});
