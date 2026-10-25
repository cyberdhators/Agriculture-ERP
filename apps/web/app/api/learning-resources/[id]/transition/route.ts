import {
  LEARNING_ACTION_NEEDS_PUBLISH,
  learningTransition,
  learningTransitionSchema,
  type LearningAction,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { forbidden, unprocessable } from '../../../../../lib/api/errors';
import {
  loadResource,
  presentResource,
  requireContentWriter,
} from '../../../../../lib/api/learning';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/learning-resources/:id/transition -- one move of a guide through
 * Advice & Learning's workflow (2026-10-22). Body: { action, note? }.
 *
 *   submit    draft | unpublished -> in_review   "Moderate content" or "Publish content"
 *   return    in_review -> draft, with a note    "Publish content"
 *   publish   in_review | unpublished -> published   "Publish content"
 *   unpublish published -> unpublished          "Publish content"
 *
 * PUBLISHING AUTHORITY IS SEPARATELY ASSIGNABLE: the moderator/editor preset
 * carries both permissions today, but either can be granted alone, and the
 * route asks for the one the move needs. A move from a state it does not
 * start from is `transition_not_allowed`, the house sentence for a decision
 * that is not open.
 *
 * Each move is its own audit row. The row records who moved it and when;
 * publishing records the publisher beside the submitter, who may be the same
 * person (OPEN in docs/DECISIONS.md: whether a publisher may publish their own
 * submission).
 */
const AUDIT_ACTION: Record<
  LearningAction,
  | 'learning_resource.submitted'
  | 'learning_resource.returned'
  | 'learning_resource.published'
  | 'learning_resource.unpublished'
> = {
  submit: 'learning_resource.submitted',
  return: 'learning_resource.returned',
  publish: 'learning_resource.published',
  unpublish: 'learning_resource.unpublished',
};

/**
 * What each move writes besides the status ($3). $2 is the actor; $4, the
 * note, is sent with a return only -- an unreferenced parameter has no type
 * Postgres can infer.
 */
const SET: Record<LearningAction, string> = {
  submit: `published = false, submitted_by = $2::uuid, submitted_at = now(), review_note = NULL`,
  return: `published = false, reviewed_by = $2::uuid, reviewed_at = now(), review_note = $4`,
  publish: `published = true, reviewed_by = $2::uuid, reviewed_at = now(), review_note = NULL,
            published_by = $2::uuid, published_at = now()`,
  unpublish: `published = false, reviewed_by = $2::uuid, reviewed_at = now()`,
};

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: learningTransitionSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const action: LearningAction = body.action;
      const access = await requireContentWriter(auth);
      if (LEARNING_ACTION_NEEDS_PUBLISH[action] && !access.publish) throw forbidden();

      const row = await audited(prisma, async (tx) => {
        const current = await loadResource(tx, params.id ?? '', true);
        const next = learningTransition(current.status, action);
        if (!next) throw unprocessable('transition_not_allowed');

        await tx.$executeRawUnsafe(
          `UPDATE public.learning_resource
              SET status = $3::public.learning_status, updated_at = now(), ${SET[action]}
            WHERE id = $1::uuid AND deleted_at IS NULL`,
          current.id,
          auth.principal.id,
          next,
          ...(action === 'return' ? [body.note ?? ''] : []),
        );
        const moved = await loadResource(tx, current.id);

        const after: Record<string, unknown> = { status: moved.status };
        if (action === 'return') after.note = moved.review_note;
        // Both people, when they are two: the publisher is the actor; the
        // submitter by id (a name never enters the audit trail).
        if (action === 'publish') after.submitted_by = current.submitted_by;
        await writeAudit(tx, {
          entityType: 'learning_resource',
          entityId: current.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: AUDIT_ACTION[action],
          before: { status: current.status },
          after,
        });
        return moved;
      });

      return ok(presentResource(row));
    },
  },
});
