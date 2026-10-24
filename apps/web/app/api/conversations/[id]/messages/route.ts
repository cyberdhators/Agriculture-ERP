import { BUYER_ROLE, FARMER_ROLE, sendMessageSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { unprocessable } from '../../../../../lib/api/errors';
import { checkId } from '../../../../../lib/api/market-posts';
import {
  actorOf,
  insertMessage,
  loadConversation,
  me,
  presentMessage,
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
    handler: async ({ auth, body, params }) => {
      const sender = me(auth);
      const id = checkId(params.id);
      const message = await audited(prisma, async (tx) => {
        const conversation = await loadConversation(tx, id, sender, true);
        if (conversation.blocked_at) throw unprocessable('conversation_blocked');
        const { row, fresh } = await insertMessage(tx, {
          id: body.id,
          conversationId: conversation.id,
          sender,
          body: body.body,
        });
        if (fresh) {
          await writeAudit(tx, {
            entityType: 'message',
            entityId: row.id,
            ...actorOf(auth),
            action: 'message.sent',
            after: { conversation_id: conversation.id },
          });
          // 2026-10-26: the other person is told of this side's FIRST message only.
          await noticeIfFirstMessage(tx, conversation.id, sender, actorOf(auth));
        }
        return row;
      });
      return created(presentMessage(message, sender));
    },
  },
});
