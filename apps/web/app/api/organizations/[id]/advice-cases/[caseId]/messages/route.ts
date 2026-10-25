import {
  BUYER_ROLE,
  FARMER_ROLE,
  mayReplyOrgAdvice,
  sendMessageSchema,
  type SendMessageInput,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../../../lib/api/audit';
import { forbidden, notFound, unprocessable } from '../../../../../../../lib/api/errors';
import { checkId } from '../../../../../../../lib/api/market-posts';
import {
  CONVERSATION_COLUMNS,
  insertMessage,
  presentMessage,
  type ConversationRow,
} from '../../../../../../../lib/api/messaging';
import { noticeIfFirstMessage } from '../../../../../../../lib/api/notify';
import {
  caseState,
  loadOrgCase,
  requireHandler,
} from '../../../../../../../lib/api/organization-advice';
import { actorFor, personOf } from '../../../../../../../lib/api/organizations';
import { created, defineRoutes } from '../../../../../../../lib/api/route';
import { prisma } from '../../../../../../../lib/db';

/**
 * POST /api/organizations/:id/advice-cases/:caseId/messages { id, body } --
 * the organisation answers a request (2026-10-28). Ask a clarifying
 * question, respond, follow up: all are messages in the case's private
 * conversation, written for the organisation's side.
 *
 * Only the member who accepted the case, or an administrator, may write
 * (mayReplyOrgAdvice): the case is not a broadcast, and one person speaks for
 * the organisation. A closed case or a blocked conversation takes no more.
 * Idempotent on the phone-made id. Audited as message.sent with ids only;
 * the requester is told about the organisation's first answer.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: sendMessageSchema,
    handler: async ({ auth, body: raw, params }) => {
      const body = raw as SendMessageInput;
      const person = personOf(auth);
      const organizationId = checkId(params.id);
      const caseId = checkId(params.caseId);
      const actor = actorFor(auth);

      const result = await audited(prisma, async (tx) => {
        const { organization, caller } = await requireHandler(tx, organizationId, person, {
          open: true,
        });
        const row = await loadOrgCase(tx, organization.id, caseId, true);
        const refusal = mayReplyOrgAdvice(caller, caseState(row));
        if (refusal === 'forbidden') throw forbidden();
        if (refusal) throw unprocessable(refusal);

        const [conversation] = await tx.$queryRawUnsafe<ConversationRow[]>(
          `SELECT ${CONVERSATION_COLUMNS} FROM public.conversation c
            WHERE c.post_kind = 'advice_case' AND c.post_id = $1::uuid
              AND c.owner_organization_id = $2::uuid
            FOR UPDATE`,
          row.id,
          organization.id,
        );
        if (!conversation) throw notFound();
        if (conversation.blocked_at) throw unprocessable('conversation_blocked');

        const { row: message, fresh } = await insertMessage(tx, {
          id: body.id,
          conversationId: conversation.id,
          sender: person,
          body: body.body,
          side: 'owner',
        });
        if (fresh) {
          await writeAudit(tx, {
            entityType: 'message',
            entityId: message.id,
            ...actor,
            action: 'message.sent',
            after: { conversation_id: conversation.id, organization_id: organization.id },
          });
          await noticeIfFirstMessage(tx, conversation.id, person, actor, 'owner');
        }
        return {
          message,
          conversation,
          viewer: { person, org: organization.id, orgName: organization.name },
        };
      });

      return created(presentMessage(result.message, result.conversation, result.viewer));
    },
  },
});
