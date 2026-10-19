import { BUYER_ROLE, FARMER_ROLE, MESSAGING_MESSAGES } from '@agri-erp/shared';

import { checkId, invalidField } from '../../../../lib/api/market-posts';
import {
  isUnread,
  loadConversation,
  me,
  presentConversation,
  presentMessage,
} from '../../../../lib/api/messaging';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/conversations/:id -- one conversation and its messages, for the two
 * people in it and nobody else (404 otherwise). The latest 200; with
 * `?after=<time>`, only what came after, which is how an open chat polls.
 *
 * Opening it marks it read for the caller. The read mark is a time on the
 * conversation, not a record, and is not audited: it changes on every visit.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params, request }) => {
      const reader = me(auth);
      const conversation = await loadConversation(prisma, checkId(params.id), reader);

      const afterRaw = new URL(request.url).searchParams.get('after');
      const after = afterRaw === null ? null : new Date(afterRaw);
      if (after !== null && Number.isNaN(after.getTime())) {
        throw invalidField('after', MESSAGING_MESSAGES.afterInvalid);
      }
      const rows = await prisma.$queryRawUnsafe<
        { id: string; body: string; sender_auth_user_id: string; created_at: Date }[]
      >(
        after === null
          ? `SELECT * FROM (
               SELECT id, body, sender_auth_user_id, created_at FROM public.message
                WHERE conversation_id = $1::uuid AND deleted_at IS NULL
                ORDER BY created_at DESC, id DESC LIMIT 200) latest
              ORDER BY created_at, id`
          : `SELECT id, body, sender_auth_user_id, created_at FROM public.message
              WHERE conversation_id = $1::uuid AND deleted_at IS NULL AND created_at > $2
              ORDER BY created_at, id LIMIT 200`,
        conversation.id,
        ...(after === null ? [] : [after]),
      );

      if (isUnread(conversation, reader)) {
        const side =
          conversation.owner_auth_user_id === reader ? 'owner_read_at' : 'starter_read_at';
        await prisma.$queryRawUnsafe(
          `UPDATE public.conversation SET ${side} = now() WHERE id = $1::uuid`,
          conversation.id,
        );
      }

      return ok({
        conversation: { ...presentConversation(conversation, reader), unread: false },
        messages: rows.map((row) => presentMessage(row, reader)),
      });
    },
  },
});
