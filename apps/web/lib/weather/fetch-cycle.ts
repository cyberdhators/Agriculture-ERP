import {
  aggregateDaily,
  metresPerSecondToKph,
  openWeatherCurrentSchema,
  openWeatherForecastSchema,
  WEATHER_CALLS_PER_MINUTE_CEILING,
} from '@agri-erp/shared';

import { prisma } from '../db';

/**
 * ONE WEATHER FETCH CYCLE, run on a schedule (2026-10-08).
 *
 * The same work as scripts/weather-fetch.mjs -- that script stays as the
 * manual tool and the GitHub backup; this is what Supabase's pg_cron calls
 * every hour through POST /api/cron/weather. The two write the same rows the
 * same way, so either can run at any time and neither duplicates (observations
 * upsert on (location, fetched_on), forecasts on (location, forecast_for)).
 *
 * C-16.6 still holds: no route a visitor or staff member opens calls
 * OpenWeather. Only the scheduler's secret-protected call does.
 */

const BASE = 'https://api.openweathermap.org/data/2.5';
const PACE_MS = Math.ceil(60_000 / WEATHER_CALLS_PER_MINUTE_CEILING);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchOutcome {
  fetched: number;
  skipped: number;
  failed: number;
  failures: string[];
}

async function get(key: string, path: string, lat: string, lon: string): Promise<unknown> {
  const res = await fetch(`${BASE}/${path}?lat=${lat}&lon=${lon}&units=metric&appid=${key}`, {
    cache: 'no-store',
  });
  const text = await res.text();
  // The key is in the URL, never in the message: only the status is reported.
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return JSON.parse(text) as unknown;
}

interface LocationRow {
  id: string;
  name: string;
  lat: string;
  lon: string;
  last_fetched_at: Date | null;
}

export async function runWeatherFetch(options: {
  key: string;
  floorMinutes: number;
}): Promise<FetchOutcome> {
  const out: FetchOutcome = { fetched: 0, skipped: 0, failed: 0, failures: [] };
  const locations = await prisma.$queryRawUnsafe<LocationRow[]>(
    `SELECT wl.id, wl.name, wl.latitude::text AS lat, wl.longitude::text AS lon,
            (SELECT max(o.fetched_at) FROM public.weather_observation o WHERE o.weather_location_id = wl.id) AS last_fetched_at
       FROM public.weather_location_active wl
      WHERE wl.active = true
      ORDER BY wl.state_id, wl.name`,
  );

  for (const loc of locations) {
    const floor = new Date(Date.now() - options.floorMinutes * 60_000);
    if (loc.last_fetched_at && new Date(loc.last_fetched_at) > floor) {
      out.skipped += 1;
      continue;
    }
    try {
      const fetchedAt = new Date();
      const currentRaw = await get(options.key, 'weather', loc.lat, loc.lon);
      await sleep(PACE_MS);
      const forecastRaw = await get(options.key, 'forecast', loc.lat, loc.lon);
      await sleep(PACE_MS);

      const current = openWeatherCurrentSchema.parse(currentRaw);
      const forecast = openWeatherForecastSchema.parse(forecastRaw);
      const days = aggregateDaily(forecast, fetchedAt);

      await prisma.$transaction(async (tx) => {
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
            JSON.stringify({ city: (forecastRaw as { city?: unknown }).city, slots }),
          );
        }
      });
      out.fetched += 1;
    } catch (error) {
      out.failed += 1;
      out.failures.push(`${loc.name}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }
  return out;
}
