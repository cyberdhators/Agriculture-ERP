import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import { sharedDetails } from '../../../../../../lib/api/advice';
import { checkId } from '../../../../../../lib/api/market-posts';
import {
  CONVERSATION_COLUMNS,
  presentMessage,
  type ConversationRow,
  type MessageRow,
  type Viewer,
} from '../../../../../../lib/api/messaging';
import {
  loadOrgCase,
  maySeeShared,
  presentOrgCase,
  requireHandler,
} from '../../../../../../lib/api/organization-advice';
import { PERSON_NAME_SQL, personOf } from '../../../../../../lib/api/organizations';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';

/**
 * GET /api/organizations/:id/advice-cases/:caseId -- one request in the
 * organisation's shared advice inbox, with its conversation (2026-10-28).
 *
 * Handlers only (requireHandler); a case of any other profile is 404. The
 * messages are the case's private conversation: the organisation's members
 * see which colleague wrote each of the organisation's messages; the
 * requester sees only the organisation's profile name. What the requester
 * chose to share (place, and phone when they asked to be called) is shown to
 * the member who accepted the case or an administrator, nobody else.
 *
 * Opening it marks the conversation read for the organisation's side, as
 * the shared inbox does: a time on the conversation, not audited.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params }) => {
      const person = personOf(auth);
      const { organization, caller } = await requireHandler(prisma, checkId(params.id), person);
      const row = await loadOrgCase(prisma, organization.id, checkId(params.caseId));

      const [conversation] = await prisma.$queryRawUnsafe<ConversationRow[]>(
        `SELECT ${CONVERSATION_COLUMNS} FROM public.conversation c
          WHERE c.post_kind = 'advice_case' AND c.post_id = $1::uuid
            AND c.owner_organization_id = $2::uuid`,
        row.id,
        organization.id,
      );
      const viewer: Viewer = { person, org: organization.id, orgName: organization.name };

      let messages: ReturnType<typeof presentMessage>[] = [];
      if (conversation) {
        const rows = await prisma.$queryRawUnsafe<MessageRow[]>(
          `SELECT * FROM (
             SELECT id, body, sender_auth_user_id, sender_side, created_at,
                    ${PERSON_NAME_SQL('message.sender_auth_user_id')} AS sender_name
               FROM public.message
              WHERE conversation_id = $1::uuid AND deleted_at IS NULL
              ORDER BY created_at DESC, id DESC LIMIT 200) latest
           ORDER BY created_at, id`,
          conversation.id,
        );
        messages = rows.map((m) => presentMessage(m, conversation, viewer));
        if (
          conversation.last_sender_side === 'starter' &&
          (conversation.owner_read_at === null ||
            conversation.owner_read_at < conversation.last_message_at)
        ) {
          await prisma.$queryRawUnsafe(
            `UPDATE public.conversation SET owner_read_at = now() WHERE id = $1::uuid`,
            conversation.id,
          );
        }
      }

      return ok({
        case: { ...presentOrgCase(row, caller), unread: false },
        shared: maySeeShared(row, caller) ? await sharedDetails(prisma, row) : null,
        blocked: conversation ? conversation.blocked_at !== null : false,
        messages,
      });
    },
  },
});
