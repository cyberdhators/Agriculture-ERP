import { BUYER_ROLE, FARMER_ROLE, adviserReplySchema } from '@agri-erp/shared';

import { loadOwnProvider } from '../../../../../../lib/api/advice';
import {
  APPLICATION_COLUMNS,
  openApplicationOf,
  presentOwnApplication,
  type ApplicationRow,
} from '../../../../../../lib/api/adviser-approval';
import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { unprocessable } from '../../../../../../lib/api/errors';
import { actorOf, me } from '../../../../../../lib/api/messaging';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';

/**
 * POST /api/advice/my-provider/application/reply { reply } -- the applicant
 * answers CORWADO's question (2026-10-24). Only an application in
 * `clarification_requested` takes an answer; it goes back to `submitted`, in
 * the queue again. The latest answer is kept on the application.
 *
 * Audited as `adviser_application.replied` with the statuses only, never the
 * answer.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: adviserReplySchema,
    handler: async ({ auth, body }) => {
      const owner = me(auth);
      const row = await audited(prisma, async (tx) => {
        const provider = await loadOwnProvider(tx, owner, true);
        const open = provider ? await openApplicationOf(tx, provider.id) : null;
        if (!open || open.status !== 'clarification_requested') {
          throw unprocessable('adviser_no_clarification');
        }
        const [changed] = await tx.$queryRawUnsafe<ApplicationRow[]>(
          `UPDATE public.adviser_application a
              SET applicant_reply = $2, status = 'submitted', updated_at = now()
            WHERE a.id = $1::uuid
            RETURNING ${APPLICATION_COLUMNS}`,
          open.id,
          body.reply,
        );
        await writeAudit(tx, {
          entityType: 'adviser_application',
          entityId: open.id,
          ...actorOf(auth),
          action: 'adviser_application.replied',
          before: { status: 'clarification_requested' },
          after: { status: 'submitted' },
        });
        return changed;
      });
      if (!row) throw unprocessable('adviser_no_clarification'); // unreachable: just written
      return ok(presentOwnApplication(row));
    },
  },
});
