import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../lib/api/errors';
import { checkId } from '../../../../../lib/api/market-posts';
import { actorOf, me } from '../../../../../lib/api/messaging';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * DELETE /api/account/blocks/:id -- unblock (2026-10-28). Ends the caller's own
 * block; the row stays as history (ended_at). Another account's block is 404,
 * like a missing one; an already-lifted block is account_block_not_found.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  DELETE: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params }) => {
      const id = checkId(params.id);
      const person = me(auth);
      await audited(prisma, async (tx) => {
        const [row] = await tx.$queryRawUnsafe<{ ended_at: Date | null }[]>(
          `SELECT ended_at FROM public.account_block
            WHERE id = $1::uuid AND blocker_auth_user_id = $2::uuid FOR UPDATE`,
          id,
          person,
        );
        if (!row) throw notFound();
        if (row.ended_at) throw unprocessable('account_block_not_found');
        await tx.$executeRawUnsafe(
          'UPDATE public.account_block SET ended_at = now() WHERE id = $1::uuid',
          id,
        );
        await writeAudit(tx, {
          entityType: 'account_block',
          entityId: id,
          ...actorOf(auth),
          action: 'account.unblocked',
          before: { blocked: true },
          after: { blocked: false },
        });
      });
      return ok({ id, unblocked: true });
    },
  },
});
