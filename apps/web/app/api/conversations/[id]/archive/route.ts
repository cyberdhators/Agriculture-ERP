import { BUYER_ROLE, FARMER_ROLE } from '@agri-erp/shared';

import { audited } from '../../../../../lib/api/audit';
import { checkId } from '../../../../../lib/api/market-posts';
import { presentConversation, setArchived, viewerOf } from '../../../../../lib/api/messaging';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * /api/conversations/:id/archive -- "Archive for me" (2026-11-03, the owner's
 * approval; docs/DECISIONS.md, "Archive for me replaces Close conversation").
 *
 * POST archives the conversation for the caller's side only: it leaves their
 * main list for the Archived tab. DELETE brings it back ("Unarchive"). For an
 * organisation's shared inbox the side is the organisation's, so it needs
 * `inbox.reply`, like answering for it. Nobody else sees any change, no live
 * event is published, and messaging is never stopped: a new message from
 * either side brings it back by itself (lib/api/messaging.ts insertMessage).
 * Archiving what is archived, or bringing back what is not, returns it as it
 * is. A conversation the caller is not part of is 404.
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
  DELETE: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params, request }) => {
      const viewer = await viewerOf(prisma, request, auth, 'inbox.reply');
      const id = checkId(params.id);
      const conversation = await audited(prisma, (tx) => setArchived(tx, id, viewer, auth, false));
      return ok(presentConversation(conversation, viewer));
    },
  },
});
