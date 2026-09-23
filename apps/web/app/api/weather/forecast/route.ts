import { ApiFailure } from '../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

import type { ForecastRow, LocationRow } from '../../../../lib/api/weather';

/**
 * GET /api/weather/forecast?payam_id=CE-JUB-xxx
 *
 * Public weather for a farmer's area. Accepts a payam_id, resolves the county,
 * and returns the weather_location row with its observation and forecast. A
 * farmer holds no server session (client-side auth stub until B12), so this
 * route is public — weather data is not sensitive.
 *
 * Returns at most one location: the payam-level one if it exists, otherwise
 * the county-level one. Shape matches the staff GET /api/weather so the
 * client can use the same types.
 *
 * NO RATE-LIMITING INFRASTRUCTURE exists in this project yet.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async (ctx) => {
      const url = new URL(ctx.request.url);
      const payamId = url.searchParams.get('payam_id');

      if (!payamId || payamId.trim().length === 0) {
        throw new ApiFailure(400, 'invalid_input', 'payam_id query parameter is required.');
      }

      const countyId = payamId.split('-').slice(0, 2).join('-');

      const rows = await prisma.$queryRawUnsafe<LocationRow[]>(
        `SELECT wl.id, wl.name, wl.level, wl.state_id, wl.county_id, c.name AS county_name,
                wl.payam_id, p.name AS payam_name, wl.latitude::text, wl.longitude::text,
                o.fetched_at, o.observed_at, o.temp_c::text, o.humidity_pct::text, o.wind_kph::text,
                o.rain_mm::text, o.conditions, o.icon
           FROM public.weather_location_active wl
           JOIN public.county c ON c.id = wl.county_id
           LEFT JOIN public.payam p ON p.id = wl.payam_id
           JOIN LATERAL (
             SELECT * FROM public.weather_observation ob
              WHERE ob.weather_location_id = wl.id
              ORDER BY ob.fetched_on DESC, ob.fetched_at DESC LIMIT 1
           ) o ON true
          WHERE wl.active = true AND wl.county_id = $1::text
          ORDER BY CASE WHEN wl.payam_id = $2::text THEN 0 ELSE 1 END, wl.name
          LIMIT 2`,
        countyId,
        payamId,
      );

      const forecasts =
        rows.length > 0
          ? await prisma.$queryRawUnsafe<ForecastRow[]>(
              `SELECT weather_location_id, forecast_for, temp_max_c::text, temp_min_c::text, rain_mm::text,
                      rain_probability::text, humidity_pct::text, wind_kph::text, conditions, icon
                 FROM public.weather_forecast
                WHERE weather_location_id = ANY($1::uuid[]) AND forecast_for > CURRENT_DATE
                ORDER BY weather_location_id, forecast_for`,
              rows.map((r) => r.id),
            )
          : [];

      const { presentLocation, attribution } = await import('../../../../lib/api/weather');
      const data = rows.map((r) => presentLocation(r, forecasts));

      return ok(data, undefined, { attribution: attribution() });
    },
  },
});
