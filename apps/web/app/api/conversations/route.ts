import { BUYER_ROLE, FARMER_ROLE, startConversationSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../lib/api/audit';
import { blockedBetween } from '../../../lib/api/blocks';
import { notFound, unprocessable } from '../../../lib/api/errors';
import {
  CONVERSATION_COLUMNS,
  actorOf,
  insertMessage,
  loadConversation,
  myName,
  postOwner,
  presentConversation,
  presentMessage,
  refusesMessages,
  startedToday,
  viewerOf,
  viewerWhere,
  type ConversationRow,
} from '../../../lib/api/messaging';
import { noticeIfFirstMessage } from '../../../lib/api/notify';
import { activeMembership } from '../../../lib/api/organizations';
import { withPresence } from '../../../lib/api/presence';
import { created, defineRoutes, paged } from '../../../lib/api/route';
import { prisma } from '../../../lib/db';

/**
 * /api/conversations -- in-app messaging (2026-10-20). docs/DECISIONS.md,
 * "In-app messaging".
 *
 * GET is the caller's inbox: every conversation they own or started, newest
 * first, each with a one-line preview and whether it is unread. At most 100;
 * an inbox longer than that is a problem for another day.
 *
 * POST starts a conversation about a post on the market, with its first
 * message -- or, when the caller already has one about that post, adds the
 * message to it. A post must be on the market; the owner of a post cannot
 * message themselves; twenty new conversations a day is the limit. Idempotent
 * on the message's phone-made id.
 *
 * 2026-10-22: an advice request's conversation (post_kind 'advice_case') is
 * listed here like any other, but is never started here: the schema accepts
 * the three post kinds only, so 'advice_case' is a 400. It is made with its
 * case, by POST /api/advice/cases.
 *
 * 2026-10-23 (public profiles v2): an owner who turned "Allow in-app
 * messaging" off on their profile cannot be sent a NEW conversation
 * (`conversation_owner_no_messages`); one already started goes on.
 *
 * 2026-10-27 (team access): THE INBOX IS THE VIEWER'S. Acting for themselves,
 * a person sees only personal conversations; acting for an organisation
 * (`inbox.read`), that organisation's shared inbox. A message to a post made
 * for an organisation lands in the organisation's inbox; starting one while
 * acting for an organisation (`inbox.reply`) speaks in its name. Nobody may
 * message their own organisation's post (`organization_own_post`).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, request }) => {
      const viewer = await viewerOf(prisma, request, auth, 'inbox.read');
      const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
        `SELECT ${CONVERSATION_COLUMNS}, last.body AS last_body
           FROM public.conversation c
           LEFT JOIN LATERAL (
             SELECT m.body FROM public.message m
              WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
              ORDER BY m.created_at DESC LIMIT 1
           ) last ON true
          WHERE ${viewerWhere('$1', '$2')}
          ORDER BY c.last_message_at DESC, c.id DESC
          LIMIT 100`,
        viewer.person,
        viewer.org,
      );
      // 2026-10-26: the other person's online dot, where both allow it (lib/api/presence.ts).
      return paged(
        await withPresence(
          prisma,
          viewer,
          rows,
          rows.map((row) => presentConversation(row, viewer)),
        ),
        { cursor: null, hasMore: false },
      );
    },
  },
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: startConversationSchema,
    handler: async ({ auth, body, request }) => {
      const viewer = await viewerOf(prisma, request, auth, 'inbox.reply');
      const sender = viewer.person;
      const post = await postOwner(prisma, body.post_kind, body.post_id);
      if (post.owner_auth_user_id === sender) throw unprocessable('conversation_own_post');
      if (post.owner_organization_id) {
        if (
          viewer.org === post.owner_organization_id ||
          (await activeMembership(prisma, post.owner_organization_id, sender))
        ) {
          throw unprocessable('organization_own_post');
        }
      }

      // 2026-10-28 (person-level block): either side's live block stops a new
      // conversation and any message in an existing one. Never says who blocked.
      if (
        post.owner_auth_user_id &&
        (await blockedBetween(prisma, sender, post.owner_auth_user_id))
      ) {
        throw unprocessable('conversation_account_blocked');
      }

      const result = await audited(prisma, async (tx) => {
        const findId = async () =>
          (
            await tx.$queryRawUnsafe<{ id: string }[]>(
              viewer.org === null
                ? `SELECT id FROM public.conversation
                    WHERE post_kind = $1 AND post_id = $2::uuid AND starter_auth_user_id = $3::uuid
                      AND starter_organization_id IS NULL`
                : `SELECT id FROM public.conversation
                    WHERE post_kind = $1 AND post_id = $2::uuid AND starter_organization_id = $3::uuid`,
              body.post_kind,
              body.post_id,
              viewer.org ?? sender,
            )
          )[0]?.id;
        let conversationId = await findId();
        if (!conversationId) {
          // 2026-10-23: the owner chose "Allow in-app messaging: off" on their
          // profile. An organisation's post is answered by its shared inbox.
          if (
            !post.owner_organization_id &&
            post.owner_auth_user_id &&
            (await refusesMessages(tx, post.owner_auth_user_id))
          ) {
            throw unprocessable('conversation_owner_no_messages');
          }
          if (await startedToday(tx, sender)) throw unprocessable('conversation_limit_reached');
          const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO public.conversation
               (post_kind, post_id, post_title, owner_auth_user_id, owner_name,
                starter_auth_user_id, starter_name, owner_organization_id,
                starter_organization_id)
             VALUES ($1, $2::uuid, $3, $4::uuid, $5, $6::uuid, $7, $8::uuid, $9::uuid)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            body.post_kind,
            body.post_id,
            post.title,
            post.owner_auth_user_id,
            post.owner_name,
            sender,
            viewer.orgName ?? (await myName(tx, sender)),
            post.owner_organization_id,
            viewer.org,
          );
          if (row) {
            await writeAudit(tx, {
              entityType: 'conversation',
              entityId: row.id,
              ...actorOf(auth),
              action: 'conversation.started',
              after: {
                post_kind: body.post_kind,
                post_id: body.post_id,
                ...(viewer.org ? { as_organization_id: viewer.org } : {}),
                ...(post.owner_organization_id
                  ? { to_organization_id: post.owner_organization_id }
                  : {}),
              },
            });
          }
          // No row: this account's other send won the race, and its conversation is this one.
          conversationId = row?.id ?? (await findId());
        }
        if (!conversationId) throw notFound();
        const conversation = await loadConversation(tx, conversationId, viewer, true);
        if (conversation.blocked_at) throw unprocessable('conversation_blocked');
        if (
          await blockedBetween(
            tx,
            conversation.owner_auth_user_id,
            conversation.starter_auth_user_id,
          )
        ) {
          throw unprocessable('conversation_account_blocked');
        }
        const { row: message, fresh } = await insertMessage(tx, {
          id: body.message_id,
          conversationId: conversation.id,
          sender,
          body: body.body,
          side: 'starter',
        });
        if (fresh) {
          await writeAudit(tx, {
            entityType: 'message',
            entityId: message.id,
            ...actorOf(auth),
            action: 'message.sent',
            after: {
              conversation_id: conversation.id,
              ...(viewer.org ? { as_organization_id: viewer.org } : {}),
            },
          });
          // 2026-10-26: the owner is told of a NEW conversation, never of each message.
          await noticeIfFirstMessage(tx, conversation.id, sender, actorOf(auth), 'starter');
        }
        const fresher = await loadConversation(tx, conversation.id, viewer);
        return {
          conversation: presentConversation(fresher, viewer),
          message: presentMessage(message, fresher, viewer),
        };
      });
      return created(result);
    },
  },
});
