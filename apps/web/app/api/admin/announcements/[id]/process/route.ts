import { remainingDeliveries } from '@agri-erp/shared';

import {
  completeIfDone,
  deliveryCounts,
  idParam,
  loadAnnouncement,
  presentAnnouncement,
  processBatch,
} from '../../../../../../lib/api/announcements';
import { notFound, unprocessable } from '../../../../../../lib/api/errors';
import { requirePermission } from '../../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { requireWriter } from '../../../../../../lib/api/scope';
import { settingValue } from '../../../../../../lib/api/settings';

/** A batch stops starting provider calls after 30 seconds; this is the ceiling. */
export const maxDuration = 60;

/**
 * POST /api/admin/announcements/:id/process (2026-10-27). ADMINISTRATOR ONLY,
 * then `communications.send`.
 *
 * ONE BATCH. Writes up to 500 queued in-app notices, then attempts up to
 * ANNOUNCEMENT_LIMITS.chunkSize queued SMS and email deliveries, writes each
 * outcome back, and answers with the counts and how many remain. The screen
 * calls it again until nothing remains; anyone holding the permission may
 * call it later to resume. Two callers never send the same delivery (rows
 * are claimed with SKIP LOCKED).
 *
 * A channel whose provider is not configured on this deployment is left
 * queued and named in `waiting_for_configuration`; nothing is reported sent
 * that was not accepted by the provider.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin'],
    handler: async ({ auth, params }) => {
      requireWriter(auth);
      await requirePermission(auth, 'communications.send');
      const id = idParam(params);
      const row = await loadAnnouncement(id);
      if (!row) throw notFound();
      if (row.status !== 'sending') throw unprocessable('announcement_not_sending');

      const identity = await settingValue('identity');
      const batch = await processBatch(auth, row, identity.service_name);
      await completeIfDone(auth, id);

      const counts = await deliveryCounts(id);
      const fresh = (await loadAnnouncement(id)) ?? row;
      return ok({
        announcement: presentAnnouncement(fresh),
        deliveries: counts,
        remaining: remainingDeliveries(counts),
        batch,
      });
    },
  },
});
