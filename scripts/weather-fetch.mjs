// pnpm weather:fetch -- fill the weather cache, one fetch per active location.
//
// THE ONLY THING IN THIS SYSTEM THAT CALLS OPENWEATHER (C-16.6). No route
// fetches; this job runs on a schedule and the routes read what it wrote.
//
//   pnpm weather:fetch            every active location not fetched in the last hour
//   pnpm weather:fetch --force    ignore the hour floor (C-16.7)
//
// PACED. The free plan allows 60 calls a minute and each location costs two
// (current + forecast). A naive loop over hundreds of locations returns 429
// partway and leaves the cache half-filled, so this sleeps between calls to
// stay under WEATHER_CALLS_PER_MINUTE_CEILING.
//
// IDEMPOTENT. Observations upsert on (location, fetched_on); forecasts upsert
// on (location, forecast_for). A retried run produces no duplicate rows.
//
// NOT AUDITED (C-16.11). A fetch is a scheduled read of a third party, not a
// person's action on a record. A failure is reported here and leaves the
// previous rows in place, which is what lets the route serve them as stale.

import console from 'node:console';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

import { PrismaClient } from '@prisma/client';

import {
  aggregateDaily,
  metresPerSecondToKph,
  openWeatherCurrentSchema,
  openWeatherForecastSchema,
  WEATHER_CALLS_PER_MINUTE_CEILING,
  WEATHER_REFETCH_FLOOR_MINUTES,
} from '../packages/shared/src/weather.ts';
import { loadEnvLocal } from './load-env.mjs';

loadEnvLocal();

const key = process.env.OPENWEATHER_API_KEY ?? '';
if (!key) {
  console.error('\nOPENWEATHER_API_KEY is not set in .env.local. Nothing was fetched.\n');
  process.exit(1);
}
const force = process.argv.includes('--force');
const BASE = 'https://api.openweathermap.org/data/2.5';
const PACE_MS = Math.ceil(60_000 / WEATHER_CALLS_PER_MINUTE_CEILING);

const db = new PrismaClient();

async function get(path, lat, lon) {
  const res = await globalThis.fetch(
    `${BASE}/${path}?lat=${lat}&lon=${lon}&units=metric&appid=${key}`,
  );
  const text = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 401
        ? ' (a fresh key returns 401 for up to two hours; if this key is new, wait)'
        : res.status === 429
          ? ' (rate limited: the pacing is too fast for this plan)'
          : '';
    throw new Error(`${path} ${res.status}${hint}: ${text.slice(0, 120)}`);
  }
  return JSON.parse(text);
}

const outcomes = { fetched: 0, skipped: 0, failed: 0 };
try {
  const locations = await db.$queryRawUnsafe(
    `SELECT wl.id, wl.name, wl.latitude::text AS lat, wl.longitude::text AS lon,
            (SELECT max(o.fetched_at) FROM public.weather_observation o WHERE o.weather_location_id = wl.id) AS last_fetched_at
       FROM public.weather_location_active wl
      WHERE wl.active = true
      ORDER BY wl.state_id, wl.name`,
  );
  console.log(
    `\nweather fetch: ${locations.length} active location(s), pacing ${PACE_MS} ms between calls${force ? ', --force' : ''}\n`,
  );

  for (const loc of locations) {
    const floor = new Date(Date.now() - WEATHER_REFETCH_FLOOR_MINUTES * 60_000);
    if (!force && loc.last_fetched_at && new Date(loc.last_fetched_at) > floor) {
      console.log(
        `  skip     ${loc.name.padEnd(26)} fetched ${new Date(loc.last_fetched_at).toISOString()} (within the ${WEATHER_REFETCH_FLOOR_MINUTES}-minute floor)`,
      );
      outcomes.skipped += 1;
      continue;
    }
    try {
      const fetchedAt = new Date();
      const currentRaw = await get('weather', loc.lat, loc.lon);
      await sleep(PACE_MS);
      const forecastRaw = await get('forecast', loc.lat, loc.lon);
      await sleep(PACE_MS);

      const current = openWeatherCurrentSchema.parse(currentRaw);
      const forecast = openWeatherForecastSchema.parse(forecastRaw);
      const days = aggregateDaily(forecast, fetchedAt);

      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO public.weather_observation
             (weather_location_id, observed_at, fetched_at, fetched_on, temp_c, humidity_pct, wind_kph, rain_mm, conditions, icon, raw)
           VALUES ($1::uuid, to_timestamp($2), $3::timestamptz, ($3::timestamptz)::date, $4, $5, $6, $7, $8, $9, $10::jsonb)
           ON CONFLICT (weather_location_id, fetched_on) DO UPDATE SET
             observed_at = EXCLUDED.observed_at, fetched_at = EXCLUDED.fetched_at, temp_c = EXCLUDED.temp_c,
             humidity_pct = EXCLUDED.humidity_pct, wind_kph = EXCLUDED.wind_kph, rain_mm = EXCLUDED.rain_mm,
             conditions = EXCLUDED.conditions, icon = EXCLUDED.icon, raw = EXCLUDED.raw`,
          loc.id,
          current.dt,
          fetchedAt.toISOString(),
          Math.round(current.main.temp * 10) / 10,
          Math.round(current.main.humidity * 10) / 10,
          metresPerSecondToKph(current.wind.speed),
          Math.round((current.rain?.['1h'] ?? 0) * 10) / 10,
          (current.weather[0]?.description ?? 'unknown').toLowerCase(),
          current.weather[0]?.icon ?? null,
          JSON.stringify(currentRaw),
        );
        for (const d of days) {
          const slots = forecast.list.filter((s) => {
            const dt = new Date((s.dt + forecast.city.timezone) * 1000).toISOString().slice(0, 10);
            return dt === d.forecast_for;
          });
          await tx.$executeRawUnsafe(
            `INSERT INTO public.weather_forecast
               (weather_location_id, forecast_for, fetched_at, temp_max_c, temp_min_c, rain_mm, rain_probability, humidity_pct, wind_kph, conditions, icon, raw)
             VALUES ($1::uuid, $2::date, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
             ON CONFLICT (weather_location_id, forecast_for) DO UPDATE SET
               fetched_at = EXCLUDED.fetched_at, temp_max_c = EXCLUDED.temp_max_c, temp_min_c = EXCLUDED.temp_min_c,
               rain_mm = EXCLUDED.rain_mm, rain_probability = EXCLUDED.rain_probability, humidity_pct = EXCLUDED.humidity_pct,
               wind_kph = EXCLUDED.wind_kph, conditions = EXCLUDED.conditions, icon = EXCLUDED.icon, raw = EXCLUDED.raw`,
            loc.id,
            d.forecast_for,
            fetchedAt.toISOString(),
            d.temp_max_c,
            d.temp_min_c,
            d.rain_mm,
            d.rain_probability,
            d.humidity_pct,
            d.wind_kph,
            d.conditions,
            d.icon,
            JSON.stringify({ city: forecastRaw.city, slots }),
          );
        }
      });
      console.log(
        `  fetched  ${loc.name.padEnd(26)} ${current.main.temp}°C "${current.weather[0]?.description}", ${days.length} day(s) of forecast`,
      );
      outcomes.fetched += 1;
    } catch (error) {
      console.error(`  FAILED   ${loc.name.padEnd(26)} ${error.message}`);
      outcomes.failed += 1;
    }
  }
} finally {
  await db.$disconnect();
}
console.log(
  `\n${outcomes.fetched} fetched, ${outcomes.skipped} skipped, ${outcomes.failed} failed.\n`,
);
process.exit(outcomes.failed > 0 ? 1 : 0);
