import {
  ADVISORY_NOTE_RULES,
  type AdvisoryNoteReviewInput,
  type AuditAction,
  advisoryNoteReviewSchema,
  holdsPermission,
} from '@agri-erp/shared';

import {
  STAFF_NOTE_SELECT,
  type StaffNoteRow,
  presentStaffNote,
} from '../../../../../../lib/api/advisory-notes';
import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { forbidden, notFound, unprocessable } from '../../../../../../lib/api/errors';
import { checkId } from '../../../../../../lib/api/market-posts';
import { notifyAccount } from '../../../../../../lib/api/notify';
import { permissionsOf } from '../../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';

/**
 * POST /api/admin/advisory-notes/:id/review { action, note? } -- a staff
 * decision on an official advisory note (2026-10-28, lane-security).
 *
 *   return     submitted -> returned, with a note the adviser sees. Either
 *              Advice & Learning reviewer: content.moderate or content.publish.
 *   publish    submitted -> published. PUBLISHING AUTHORITY ONLY
 *              (content.publish), as the specification separates it, and only
 *              while the adviser's approval stands and is not suspended.
 *   unpublish  published -> unpublished, with a note. content.publish.
 *
 * One transaction: the note, one audit row (status and the staff note, never
 * the note's own text) and one fixed-sentence notice to the adviser.
 */
const AUDIT: Record<AdvisoryNoteReviewInput['action'], AuditAction> = {
  return: 'advisory_note.returned',
  publish: 'advisory_note.published',
  unpublish: 'advisory_note.unpublished',
};

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin'],
    bodySchema: advisoryNoteReviewSchema,
    handler: async ({ auth, body: raw, params }) => {
      const body = raw as AdvisoryNoteReviewInput;
      const permissions = await permissionsOf(auth);
      const publisher = holdsPermission(permissions, 'content.publish');
      const reviewer = publisher || holdsPermission(permissions, 'content.moderate');
      if (!reviewer || (body.action !== 'return' && !publisher)) throw forbidden();

      const id = checkId(params.id);
      const rule = ADVISORY_NOTE_RULES[body.action];

      const row = await audited(prisma, async (tx) => {
        const [current] = await tx.$queryRawUnsafe<StaffNoteRow[]>(
          `${STAFF_NOTE_SELECT} WHERE n.id = $1::uuid AND n.deleted_at IS NULL FOR UPDATE OF n`,
          id,
        );
        if (!current) throw notFound();
        if (!(rule.from as readonly string[]).includes(current.status)) {
          throw unprocessable('advisory_note_not_allowed');
        }
        if (body.action === 'publish' && !current.approval_active) {
          throw unprocessable('advisory_note_not_approved');
        }
        const [author] = await tx.$queryRawUnsafe<{ auth_user_id: string }[]>(
          `SELECT auth_user_id FROM public.advisory_note WHERE id = $1::uuid`,
          id,
        );

        await tx.$executeRawUnsafe(
          `UPDATE public.advisory_note
              SET status = $2, review_note = COALESCE($3, review_note),
                  reviewed_by = $4::uuid, reviewed_at = now(),
                  published_by = CASE WHEN $2 = 'published' THEN $4::uuid ELSE published_by END,
                  published_at = CASE WHEN $2 = 'published' THEN now() ELSE published_at END,
                  updated_at = now()
            WHERE id = $1::uuid`,
          id,
          rule.to,
          body.note ?? null,
          auth.principal.id,
        );
        await writeAudit(tx, {
          entityType: 'advisory_note',
          entityId: id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: AUDIT[body.action],
          before: { status: current.status },
          after: {
            status: rule.to,
            provider_id: current.provider_id,
            ...(body.note ? { note: body.note } : {}),
          },
        });
        if (author) {
          await notifyAccount(tx, { authUserId: author.auth_user_id }, 'advisory_note_reviewed', {
            actorType: auth.role,
            actorId: auth.principal.id,
          });
        }
        const [fresh] = await tx.$queryRawUnsafe<StaffNoteRow[]>(
          `${STAFF_NOTE_SELECT} WHERE n.id = $1::uuid`,
          id,
        );
        return fresh as StaffNoteRow;
      });
      return ok(presentStaffNote(row));
    },
  },
});
