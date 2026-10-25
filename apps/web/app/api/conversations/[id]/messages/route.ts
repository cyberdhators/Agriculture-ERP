import { BUYER_ROLE, FARMER_ROLE, sendMessageSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { blockedBetween } from '../../../../../lib/api/blocks';
import { unprocessable } from '../../../../../lib/api/errors';
import { checkId } from '../../../../../lib/api/market-posts';
import {
  actorOf,
  insertMessage,
  loadConversation,
  presentMessage,
  sideOf,
  viewerOf,
} from '../../../../../lib/api/messaging';
import { noticeIfFirstMessage } from '../../../../../lib/api/notify';
import { created, defineRoutes } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/conversations/:id/messages -- one message, from either person in
 * the conversation (404 for anyone else). Idempotent on its phone-made id, so
 * a message queued with no signal and sent twice is stored once. Refused once
 * either side has blocked the conversation.
 *
 * The audit row names the conversation; the text never enters it.
 * 2026-10-26: a side's first message sends the other one notice
 * (noticeIfFirstMessage), naming only the kind of post.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: sendMessageSchema,
    handler: async ({ auth, body, params, request }) => {
      // 2026-10-27: for an organisation's inbox, `inbox.reply`.
      const viewer = await viewerOf(prisma, request, auth, 'inbox.reply');
      const sender = viewer.person;
      const id = checkId(params.id);
      const { message, conversation } = await audited(prisma, async (tx) => {
        const conversation = await loadConversation(tx, id, viewer, true);
        if (conversation.blocked_at) throw unprocessable('conversation_blocked');
        // 2026-10-28: a person-level block between the two people, either way.
        if (
          await blockedBetween(
            tx,
            conversation.owner_auth_user_id,
            conversation.starter_auth_user_id,
          )
        ) {
          throw unprocessable('conversation_account_blocked');
        }
        const side = sideOf(conversation, viewer);
        const { row, fresh } = await insertMessage(tx, {
          id: body.id,
          conversationId: conversation.id,
          sender,
          body: body.body,
          side,
        });
        if (fresh) {
          await writeAudit(tx, {
            entityType: 'message',
            entityId: row.id,
            ...actorOf(auth),
            action: 'message.sent',
            after: {
              conversation_id: conversation.id,
              ...(viewer.org ? { as_organization_id: viewer.org } : {}),
            },
          });
          // 2026-10-26: the other person is told of this side's FIRST message only.
          await noticeIfFirstMessage(tx, conversation.id, sender, actorOf(auth), side);
        }
        return { message: row, conversation };
      });
      return created(presentMessage(message, conversation, viewer));
    },
  },
});
