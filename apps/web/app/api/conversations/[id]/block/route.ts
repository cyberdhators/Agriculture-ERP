import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import { audited } from '../../../../../lib/api/audit';
import { checkId } from '../../../../../lib/api/market-posts';
import { presentConversation, setArchived, viewerOf } from '../../../../../lib/api/messaging';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/conversations/:id/block -- KEPT FOR COMPATIBILITY ONLY.
 *
 * Until 2026-11-03 this closed the conversation for both people for good
 * (blocked_at). The owner replaced that with "Archive for me" (docs/DECISIONS.md,
 * "Archive for me replaces Close conversation"): an app still holding the old
 * button, or any other old caller, now ARCHIVES the conversation for the
 * caller's side instead -- exactly POST /api/conversations/:id/archive -- so
 * no new conversation is ever closed. A conversation closed before then stays
 * closed (its blocked_at is never changed here). To stop someone writing,
 * people block the person (POST /api/account/blocks).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params, request }) => {
      const viewer = await viewerOf(prisma, request, auth, 'inbox.reply');
      const id = checkId(params.id);
      const conversation = await audited(prisma, (tx) => setArchived(tx, id, viewer, auth, true));
      return ok(presentConversation(conversation, viewer));
    },
  },
});
