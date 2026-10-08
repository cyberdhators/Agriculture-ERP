import { timingSafeEqual } from 'node:crypto';

import { WEATHER_SCHEDULED_FLOOR_MINUTES, emptyBodySchema } from '@agri-erp/shared';

import { unauthenticated } from '../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { runWeatherFetch } from '../../../../lib/weather/fetch-cycle';

/**
 * POST /api/cron/weather -- the hourly weather fetch, called by Supabase's
 * pg_cron (the owner, 2026-10-08: GitHub's scheduler ran the job every 4-8
 * hours in practice, not hourly).
 *
 * `roles: 'public'` because the caller is a scheduler, not a person with a
 * session -- but it is NOT open: it answers 401 unless the request carries
 * `Authorization: Bearer <CRON_SECRET>`, compared in constant time, and it
 * fails CLOSED when CRON_SECRET is not configured. It takes no input and
 * returns only counts. C-16.6 holds: no route a visitor or staff member opens
 * calls OpenWeather; only this scheduler-only route does, and only on the
 * hourly floor.
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

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: emptyBodySchema,
    handler: async ({ request }) => {
      if (!authorised(request)) throw unauthenticated();
      const key = process.env.OPENWEATHER_API_KEY ?? '';
      if (!key)
        return ok({
          fetched: 0,
          skipped: 0,
          failed: 0,
          failures: ['OPENWEATHER_API_KEY is not set'],
        });
      const outcome = await runWeatherFetch({ key, floorMinutes: WEATHER_SCHEDULED_FLOOR_MINUTES });
      return ok(outcome);
    },
  },
});
