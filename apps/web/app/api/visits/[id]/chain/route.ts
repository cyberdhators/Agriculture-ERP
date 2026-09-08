import { defineRoutes, ok } from '../../../../../lib/api/route';
import {
  attachmentsOf,
  chainOf,
  loadVisibleVisit,
  presentVisit,
} from '../../../../../lib/api/visits';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/visits/:id/chain — the follow-up chain in order (C-8.3): every
 * earlier visit from the first down to this one, then this one, then its
 * direct follow-ups. Scoped by the visit; the chain never leaves the farmer,
 * so what is visible for one is visible for all. A removed ancestor is its
 * id and `removed: true`, nothing else (C-8.11).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ auth, params }) => {
      const visit = await loadVisibleVisit(prisma, params.id ?? '', auth);
      const { ancestors, followUps } = await chainOf(prisma, visit);
      const live = [...ancestors.filter((v) => !v.deleted_at), visit, ...followUps];
      const attachments = await attachmentsOf(
        prisma,
        live.map((v) => v.id),
      );
      return ok({
        earlier: ancestors.map((v) =>
          v.deleted_at ? { id: v.id, removed: true } : presentVisit(v, attachments, auth),
        ),
        visit: presentVisit(visit, attachments, auth),
        follow_ups: followUps.map((v) => presentVisit(v, attachments, auth)),
      });
    },
  },
});
