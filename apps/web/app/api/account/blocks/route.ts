import { BUYER_ROLE, FARMER_ROLE, blockAccountSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { presentBlock, type BlockRow } from '../../../../lib/api/blocks';
import { unprocessable } from '../../../../lib/api/errors';
import { actorOf, loadConversation, me, sideOf, viewerOf } from '../../../../lib/api/messaging';
import { created, defineRoutes, ok, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * /api/account/blocks -- the accounts the caller has blocked (2026-10-28,
 * CORWADO's specification: "Provide report, block and support functions").
 * docs/DECISIONS.md, "Person-level block".
 *
 * GET lists the caller's live blocks: the name they saw and when. Never the
 * other account's id, phone or email.
 *
 * POST blocks the OTHER PERSON in a conversation the caller is part of, acting
 * for themselves. The account is read from the conversation, never taken from
 * the body, so nobody can block (or probe) an account they have not talked to.
 * Blocking someone already blocked returns the existing block. From an
 * organisation's shared inbox it is refused (account_block_personal_only):
 * the inbox's own "close conversation" is the organisation's tool.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth }) => {
      const rows = await prisma.$queryRawUnsafe<BlockRow[]>(
        `SELECT id, blocked_name, created_at FROM public.account_block
          WHERE blocker_auth_user_id = $1::uuid AND ended_at IS NULL
          ORDER BY created_at DESC, id DESC LIMIT 200`,
        me(auth),
      );
      return paged(rows.map(presentBlock), { cursor: null, hasMore: false });
    },
  },
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: blockAccountSchema,
    handler: async ({ auth, body, request }) => {
      const viewer = await viewerOf(prisma, request, auth, 'inbox.read');
      if (viewer.org !== null) throw unprocessable('account_block_personal_only');
      const result = await audited(prisma, async (tx) => {
        const conversation = await loadConversation(tx, body.conversation_id, viewer);
        const mine = sideOf(conversation, viewer);
        const other =
          mine === 'owner' ? conversation.starter_auth_user_id : conversation.owner_auth_user_id;
        const name = mine === 'owner' ? conversation.starter_name : conversation.owner_name;
        if (other === viewer.person) throw unprocessable('account_block_self');
        const [existing] = await tx.$queryRawUnsafe<BlockRow[]>(
          `SELECT id, blocked_name, created_at FROM public.account_block
            WHERE blocker_auth_user_id = $1::uuid AND blocked_auth_user_id = $2::uuid
              AND ended_at IS NULL`,
          viewer.person,
          other,
        );
        if (existing) return { row: existing, fresh: false };
        const [row] = await tx.$queryRawUnsafe<BlockRow[]>(
          `INSERT INTO public.account_block (blocker_auth_user_id, blocked_auth_user_id, blocked_name)
           VALUES ($1::uuid, $2::uuid, $3)
           RETURNING id, blocked_name, created_at`,
          viewer.person,
          other,
          name.slice(0, 200),
        );
        await writeAudit(tx, {
          entityType: 'account_block',
          entityId: row!.id,
          ...actorOf(auth),
          action: 'account.blocked',
          // Ids only: the conversation it was made from. Never a name.
          after: { conversation_id: conversation.id },
        });
        return { row: row!, fresh: true };
      });
      return result.fresh ? created(presentBlock(result.row)) : ok(presentBlock(result.row));
    },
  },
});
