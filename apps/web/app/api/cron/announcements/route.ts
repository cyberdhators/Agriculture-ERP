import { timingSafeEqual } from 'node:crypto';

import { emptyBodySchema } from '@agri-erp/shared';

import { runAnnouncementQueue } from '../../../../lib/api/announcement-queue';
import { unauthenticated } from '../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../lib/api/route';

/**
 * POST (and GET) /api/cron/announcements -- moves every announcement that is
 * still sending on by a batch or more, without anyone's screen open
 * (2026-10-29). Called every two minutes by Supabase pg_cron, installed by
 * scripts/announcements-cron-install.mjs, exactly like the weather and
 * expiry-reminder jobs. The announcement page keeps driving its own batches
 * too; the two never send the same delivery (lib/api/announcement-queue.ts).
 *
 * `roles: 'public'` because the caller is a scheduler, not a person with a
 * session -- but it is NOT open: it answers 401 unless the request carries
 * `Authorization: Bearer <CRON_SECRET>`, compared in constant time, and it
 * fails CLOSED when CRON_SECRET is not configured. It takes no input and
 * returns only counts.
 */
export const maxDuration = 60;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? '';
  if (secret.length < 32) return false;
  const given = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run(request: Request) {
  if (!authorised(request)) throw unauthenticated();
  return ok(await runAnnouncementQueue());
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: ({ request }) => run(request),
  },
  POST: {
    roles: 'public',
    bodySchema: emptyBodySchema,
    handler: ({ request }) => run(request),
  },
});
