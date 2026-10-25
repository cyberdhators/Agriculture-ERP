import { buildPreview, idParam, loadAnnouncement } from '../../../../../../lib/api/announcements';
import { notFound } from '../../../../../../lib/api/errors';
import { requirePermission } from '../../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../../lib/api/route';

/**
 * GET /api/admin/announcements/:id/preview (2026-10-27). ADMINISTRATOR ONLY,
 * then `communications.send`. Reads only; sends nothing.
 *
 * The text as a recipient sees it (with an example name), how many accounts
 * are in scope, and per channel how many will be sent and how many are left
 * out and why -- each person's preferences applied, exactly as the send will
 * apply them (one plan, lib/api/announcements.ts). For SMS, the billed parts
 * and, when a cost per part is set, the estimated cost.
 *
 * The send must quote this preview's recipient count, so nothing goes to a
 * group the sender did not see.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ auth, params }) => {
      await requirePermission(auth, 'communications.send');
      const row = await loadAnnouncement(idParam(params));
      if (!row) throw notFound();
      return ok(await buildPreview(row));
    },
  },
});
