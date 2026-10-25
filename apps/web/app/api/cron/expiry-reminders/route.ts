import { timingSafeEqual } from 'node:crypto';

import { emptyBodySchema } from '@agri-erp/shared';

import { unauthenticated } from '../../../../lib/api/errors';
import { runExpiryReminders } from '../../../../lib/api/expiry-reminders';
import { defineRoutes, ok } from '../../../../lib/api/route';

/**
 * POST (and GET) /api/cron/expiry-reminders -- the daily reminder that a post
 * ends soon (2026-10-28). Called by Supabase pg_cron, installed by
 * scripts/expiry-reminders-cron-install.mjs, exactly like the hourly weather
 * job (the owner, 2026-10-08, chose pg_cron over GitHub's scheduler). GET is
 * accepted too, with the same secret, so a Vercel cron could call it later
 * without a code change; none is configured (no vercel.json).
 *
 * `roles: 'public'` because the caller is a scheduler, not a person with a
 * session -- but it is NOT open: it answers 401 unless the request carries
 * `Authorization: Bearer <CRON_SECRET>`, compared in constant time, and it
 * fails CLOSED when CRON_SECRET is not configured. It takes no input and
 * returns only counts. Idempotent: a second run the same day sends nothing
 * (lib/api/expiry-reminders.ts).
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
  return ok(await runExpiryReminders());
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
