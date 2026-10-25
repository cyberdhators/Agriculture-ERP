import { BUYER_ROLE, FARMER_ROLE, MESSAGING_MESSAGES } from '@agri-erp/shared';

import { checkId, invalidField } from '../../../../lib/api/market-posts';
import {
  isUnread,
  loadConversation,
  presentConversation,
  presentMessage,
  sideOf,
  viewerOf,
  type MessageRow,
} from '../../../../lib/api/messaging';
import { PERSON_NAME_SQL } from '../../../../lib/api/organizations';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/conversations/:id -- one conversation and its messages, for the two
 * people in it and nobody else (404 otherwise). The latest 200; with
 * `?after=<time>`, only what came after, which is how an open chat polls.
 *
 * Opening it marks it read for the caller. The read mark is a time on the
 * conversation, not a record, and is not audited: it changes on every visit.
 *
 * 2026-10-27: for the viewer -- the person, or the organisation they act for
 * with `inbox.read`. An organisation's members also see which colleague wrote
 * each of the organisation's messages; the read mark is the organisation's.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params, request }) => {
      const viewer = await viewerOf(prisma, request, auth, 'inbox.read');
      const conversation = await loadConversation(prisma, checkId(params.id), viewer);
      // Only an organisation's members are told which colleague wrote.
      const names = viewer.org
        ? `, ${PERSON_NAME_SQL('message.sender_auth_user_id')} AS sender_name`
        : '';

      const afterRaw = new URL(request.url).searchParams.get('after');
      const after = afterRaw === null ? null : new Date(afterRaw);
      if (after !== null && Number.isNaN(after.getTime())) {
        throw invalidField('after', MESSAGING_MESSAGES.afterInvalid);
      }
      const rows = await prisma.$queryRawUnsafe<MessageRow[]>(
        after === null
          ? `SELECT * FROM (
               SELECT id, body, sender_auth_user_id, sender_side, created_at${names}
                 FROM public.message
                WHERE conversation_id = $1::uuid AND deleted_at IS NULL
                ORDER BY created_at DESC, id DESC LIMIT 200) latest
              ORDER BY created_at, id`
          : `SELECT id, body, sender_auth_user_id, sender_side, created_at${names}
               FROM public.message
              WHERE conversation_id = $1::uuid AND deleted_at IS NULL AND created_at > $2
              ORDER BY created_at, id LIMIT 200`,
        conversation.id,
        ...(after === null ? [] : [after]),
      );

      if (isUnread(conversation, viewer)) {
        const side =
          sideOf(conversation, viewer) === 'owner' ? 'owner_read_at' : 'starter_read_at';
        await prisma.$queryRawUnsafe(
          `UPDATE public.conversation SET ${side} = now() WHERE id = $1::uuid`,
          conversation.id,
        );
      }

      return ok({
        conversation: { ...presentConversation(conversation, viewer), unread: false },
        messages: rows.map((row) => presentMessage(row, conversation, viewer)),
      });
    },
  },
});
