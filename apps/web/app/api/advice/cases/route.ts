import {
  BUYER_ROLE,
  FARMER_ROLE,
  adviceCaseCreateSchema,
  adviceCaseListSchema,
  type AdviceCaseCreate,
} from '@agri-erp/shared';

import {
  CASE_SELECT,
  PROVIDER_ACCOUNT_LIVE,
  casesToday,
  loadCase,
  presentCase,
  type CaseRow,
} from '../../../../lib/api/advice';
import { audited, writeAudit, type AuditTx } from '../../../../lib/api/audit';
import { blockedBetween } from '../../../../lib/api/blocks';
import { conflict, notFound, unprocessable } from '../../../../lib/api/errors';
import { parseQuery } from '../../../../lib/api/market-posts';
import { actorOf, insertMessage, me, myName } from '../../../../lib/api/messaging';
import { noticeIfFirstMessage } from '../../../../lib/api/notify';
import { created, defineRoutes, ok, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * /api/advice/cases -- advice requests (2026-10-22). docs/DECISIONS.md,
 * "Advice: find a provider and ask".
 *
 * GET lists the caller's own cases: `?role=requester` (the default) those
 * they asked, `?role=provider` those asked of their advice profile. Newest
 * first, at most 200; the screens split them into open, in progress and
 * closed.
 *
 * POST asks one provider one question. The requester chooses the provider;
 * nothing is assigned. In one audited transaction it stores the case, opens
 * its conversation (in-app messaging, owned by the provider, started by the
 * requester) and posts the question as the first message -- so the two can
 * talk at once, in the inbox they already have. The provider must be
 * published with a live account; nobody may ask their own profile; ten new
 * requests a day per account. Idempotent on the phone-made id, which is also
 * the first message's id.
 *
 * The audit rows carry ids and choices, never the question.
 */

/** The same request sent again: the same id, the same asker, the same question. */
const sameRequest = (row: CaseRow, requester: string, body: AdviceCaseCreate) =>
  row.requester_auth_user_id === requester &&
  row.provider_id === body.provider_id &&
  row.topic === body.topic &&
  row.question === body.question &&
  row.preferred_contact === body.preferred_contact &&
  row.share_details === body.share_details;

/** An earlier send of this id, returned as it was; anyone else's id is a conflict. */
async function earlier(
  db: Pick<AuditTx, '$queryRawUnsafe'>,
  requester: string,
  body: AdviceCaseCreate,
) {
  const [row] = await db.$queryRawUnsafe<CaseRow[]>(
    `${CASE_SELECT} WHERE ac.id = $1::uuid`,
    body.id,
  );
  if (!row) return null;
  if (!sameRequest(row, requester, body)) throw conflict('advice_case_already_exists');
  return row;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, request }) => {
      const reader = me(auth);
      const { role } = parseQuery(request, adviceCaseListSchema);
      const rows = await prisma.$queryRawUnsafe<CaseRow[]>(
        `${CASE_SELECT}
          WHERE ac.deleted_at IS NULL
            AND ${role === 'provider' ? 'p.auth_user_id' : 'ac.requester_auth_user_id'} = $1::uuid
          ORDER BY ac.created_at DESC, ac.id DESC
          LIMIT 200`,
        reader,
      );
      return paged(await Promise.all(rows.map((row) => presentCase(prisma, row, reader))), {
        cursor: null,
        hasMore: false,
      });
    },
  },

  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: adviceCaseCreateSchema,
    handler: async ({ auth, body }) => {
      const requester = me(auth);

      // A resend of a request already stored is answered as it was, even if
      // the provider has since stopped taking requests.
      const resent = await earlier(prisma, requester, body);
      if (resent) return ok(await presentCase(prisma, resent, requester));

      const [provider] = await prisma.$queryRawUnsafe<
        { id: string; auth_user_id: string; display_name: string; open: boolean }[]
      >(
        `SELECT p.id, p.auth_user_id, p.display_name,
                (p.status = 'published' AND ${PROVIDER_ACCOUNT_LIVE}) AS open
           FROM public.advice_provider p
          WHERE p.id = $1::uuid AND p.deleted_at IS NULL`,
        body.provider_id,
      );
      if (!provider) throw notFound();
      if (provider.auth_user_id === requester) throw unprocessable('advice_own_provider');
      if (!provider.open) throw unprocessable('advice_provider_not_published');
      // 2026-10-28: a person-level block stops an advice case as it stops a
      // conversation (either side's block; the refusal never says whose).
      if (await blockedBetween(prisma, requester, provider.auth_user_id))
        throw unprocessable('conversation_account_blocked');

      const row = await audited(prisma, async (tx) => {
        if (await casesToday(tx, requester)) throw unprocessable('advice_case_limit_reached');
        const name = await myName(tx, requester);

        const [inserted] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.advice_case
             (id, provider_id, requester_auth_user_id, requester_name, topic, question,
              preferred_contact, share_details)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          body.id,
          provider.id,
          requester,
          name,
          body.topic,
          body.question,
          body.preferred_contact,
          body.share_details,
        );
        if (!inserted) {
          // Another send of the same id won the race: it is this request, or a conflict.
          const raced = await earlier(tx, requester, body);
          if (!raced) throw notFound();
          return raced;
        }
        await writeAudit(tx, {
          entityType: 'advice_case',
          entityId: body.id,
          ...actorOf(auth),
          action: 'advice_case.created',
          after: {
            provider_id: provider.id,
            topic: body.topic,
            status: 'open',
            preferred_contact: body.preferred_contact,
            share_details: body.share_details,
          },
        });

        // The conversation's title is the topic's key; the screens translate it.
        const [conversation] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.conversation
             (post_kind, post_id, post_title, owner_auth_user_id, owner_name,
              starter_auth_user_id, starter_name)
           VALUES ('advice_case', $1::uuid, $2, $3::uuid, $4, $5::uuid, $6)
           RETURNING id`,
          body.id,
          body.topic,
          provider.auth_user_id,
          provider.display_name,
          requester,
          name,
        );
        if (!conversation) throw notFound();
        await writeAudit(tx, {
          entityType: 'conversation',
          entityId: conversation.id,
          ...actorOf(auth),
          action: 'conversation.started',
          after: { post_kind: 'advice_case', post_id: body.id },
        });
        const { row: message } = await insertMessage(tx, {
          id: body.id,
          conversationId: conversation.id,
          sender: requester,
          body: body.question,
        });
        await writeAudit(tx, {
          entityType: 'message',
          entityId: message.id,
          ...actorOf(auth),
          action: 'message.sent',
          after: { conversation_id: conversation.id },
        });
        // 2026-10-26: the provider is told there is a new request; never its text.
        await noticeIfFirstMessage(tx, conversation.id, requester, actorOf(auth));
        return loadCase(tx, body.id, requester);
      });
      return created(await presentCase(prisma, row, requester));
    },
  },
});
