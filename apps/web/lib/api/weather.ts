import { isStale, WEATHER_ATTRIBUTION } from '@agri-erp/shared';

import type { Authenticated } from './require-role';

/**
 * C-16 -- the weather tile's read side. One route, no parameters, no fetching.
 * The agreed shape is docs/api/weather-contract.md; CONVENTIONS section 18
 * records where the build had to differ from it and why.
 */

type Db = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export interface LocationRow {
  id: string;
  name: string;
  level: 'county' | 'payam';
  state_id: string;
  county_id: string;
  county_name: string;
  payam_id: string | null;
  payam_name: string | null;
  latitude: string;
  longitude: string;
  // From the latest observation; null when never fetched.
  fetched_at: Date | null;
  observed_at: Date | null;
  temp_c: string | null;
  humidity_pct: string | null;
  wind_kph: string | null;
  rain_mm: string | null;
  conditions: string | null;
  icon: string | null;
}

export interface ForecastRow {
  weather_location_id: string;
  forecast_for: Date;
  temp_max_c: string;
  temp_min_c: string;
  rain_mm: string;
  rain_probability: string;
  humidity_pct: string;
  wind_kph: string;
  conditions: string;
  icon: string | null;
}

/**
 * Who sees which locations (C-16.8). Admin all; supervisor and read_only their
 * state; AN OFFICER THEIR COUNTY -- the contract said payam, and with
 * county-level locations (C-16.13) a payam scope would show most officers
 * nothing. Weather is about where an officer works, and the county is the unit
 * we have data for. Recorded as a divergence in CONVENTIONS section 18.
 */
export function weatherScopeClause(auth: Authenticated, params: unknown[]): string[] {
  if (auth.scope.kind === 'state') {
    params.push(auth.scope.stateId);
    return [`wl.state_id = $${params.length}::text`];
  }
  if (auth.scope.kind === 'caseload') {
    params.push(auth.scope.payamId);
    return [
      `wl.county_id = (SELECT p.county_id FROM public.payam p WHERE p.id = $${params.length}::text)`,
    ];
  }
  return [];
}

/**
 * Active locations in scope that have been fetched at least once, with their
 * latest observation. A location never fetched is OMITTED rather than served
 * with a null fetched_at: the contract promises fetched_at is always present
 * and always real, and a row with nothing to show would only be a puzzle on a
 * screen. It appears the moment its first fetch lands.
 */
export async function loadLocations(db: Db, auth: Authenticated): Promise<LocationRow[]> {
  const params: unknown[] = [];
  const scope = weatherScopeClause(auth, params);
  const where = ['wl.active = true', ...scope].join(' AND ');
  return db.$queryRawUnsafe<LocationRow[]>(
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
      WHERE ${where}
      ORDER BY wl.state_id, c.name, wl.name`,
    ...params,
  );
}

/** Forecast rows from tomorrow on, ascending, for the given locations. */
export async function loadForecasts(
  db: Db,
  locationIds: readonly string[],
): Promise<ForecastRow[]> {
  if (locationIds.length === 0) return [];
  return db.$queryRawUnsafe<ForecastRow[]>(
    `SELECT weather_location_id, forecast_for, temp_max_c::text, temp_min_c::text, rain_mm::text,
            rain_probability::text, humidity_pct::text, wind_kph::text, conditions, icon
       FROM public.weather_forecast
      WHERE weather_location_id = ANY($1::uuid[]) AND forecast_for > CURRENT_DATE
      ORDER BY weather_location_id, forecast_for`,
    locationIds,
  );
}

const num = (s: string | null): number | null => (s === null ? null : Number(s));
const day = (d: Date): string => d.toISOString().slice(0, 10);

/** The contract's shape. Numbers are numbers; nothing here is a sentence. */
export function presentLocation(
  row: LocationRow,
  forecasts: readonly ForecastRow[],
  now: Date = new Date(),
): Record<string, unknown> {
  const fetchedAt = row.fetched_at as Date;
  return {
    location_id: row.id,
    name: row.name,
    level: row.level,
    payam_id: row.payam_id,
    payam_name: row.payam_name,
    county_id: row.county_id,
    county_name: row.county_name,
    state_id: row.state_id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    fetched_at: fetchedAt.toISOString(),
    stale: isStale(fetchedAt, now),
    current: {
      observed_at: row.observed_at ? row.observed_at.toISOString() : null,
      temp_c: num(row.temp_c),
      humidity_pct: num(row.humidity_pct),
      wind_kph: num(row.wind_kph),
      rain_mm: num(row.rain_mm),
      conditions: row.conditions,
      icon: row.icon,
    },
    forecast: forecasts
      .filter((f) => f.weather_location_id === row.id)
      .map((f) => ({
        forecast_for: day(f.forecast_for),
        temp_max_c: Number(f.temp_max_c),
        temp_min_c: Number(f.temp_min_c),
        rain_mm: Number(f.rain_mm),
        rain_probability: Number(f.rain_probability),
        humidity_pct: Number(f.humidity_pct),
        wind_kph: Number(f.wind_kph),
        conditions: f.conditions,
        icon: f.icon,
      })),
  };
}

export const attribution = () => ({ ...WEATHER_ATTRIBUTION });
