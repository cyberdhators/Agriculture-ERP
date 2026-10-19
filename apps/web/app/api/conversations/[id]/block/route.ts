import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { checkId } from '../../../../../lib/api/market-posts';
import {
  actorOf,
  loadConversation,
  me,
  presentConversation,
} from '../../../../../lib/api/messaging';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/conversations/:id/block -- either person closes the conversation:
 * no more messages from either side. What was said stays, for both. Blocking
 * an already-blocked conversation changes nothing and says so by returning it
 * as it is. There is no unblock yet; a person who wants to talk again starts
 * over from another post, or asks CORWADO.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params }) => {
      const reader = me(auth);
      const id = checkId(params.id);
      const conversation = await audited(prisma, async (tx) => {
        const row = await loadConversation(tx, id, reader, true);
        if (row.blocked_at) return row;
        await tx.$queryRawUnsafe(
          `UPDATE public.conversation SET blocked_at = now(), blocked_by = $2::uuid
            WHERE id = $1::uuid`,
          row.id,
          reader,
        );
        await writeAudit(tx, {
          entityType: 'conversation',
          entityId: row.id,
          ...actorOf(auth),
          action: 'conversation.blocked',
          before: { blocked: false },
          after: { blocked: true },
        });
        return loadConversation(tx, row.id, reader);
      });
      return ok(presentConversation(conversation, reader));
    },
  },
});
