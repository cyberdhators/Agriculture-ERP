import { ALL_ROLES } from '@agri-erp/shared';

import { defineRoutes, ok } from '../../../lib/api/route';
import { prisma } from '../../../lib/db';

const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY ?? '';

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const CACHE_TTL_MS = 30 * 60 * 1000;

interface CacheEntry {
  data: WeatherLocationRow;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

interface CountyRow {
  id: string;
  name: string;
  state_id: string;
}

interface WeatherLocationRow {
  location_id: string;
  name: string;
  level: 'county';
  payam_id: null;
  payam_name: null;
  county_id: string;
  county_name: string;
  state_id: string;
  latitude: number;
  longitude: number;
  fetched_at: string;
  stale: boolean;
  current: {
    observed_at: string | null;
    temp_c: number;
    humidity_pct: number;
    wind_kph: number;
    rain_mm: number;
    conditions: string;
    icon: string | null;
  } | null;
  forecast: Array<{
    forecast_for: string;
    temp_max_c: number;
    temp_min_c: number;
    rain_mm: number;
    rain_probability: number;
    humidity_pct: number;
    wind_kph: number;
    conditions: string;
    icon: string | null;
  }>;
}

const COUNTY_COORDS: Record<string, { lat: number; lon: number }> = {
  'CE-JUB': { lat: 4.85, lon: 31.58 },
};

async function fetchWeatherForCounty(
  county: CountyRow,
): Promise<WeatherLocationRow | null> {
  if (!OPENWEATHER_KEY) return null;

  const coords = COUNTY_COORDS[county.id] ?? { lat: 4.85, lon: 31.58 };

  const cached = cache.get(county.id);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      ...cached.data,
      stale: Date.now() - cached.fetchedAt > STALE_THRESHOLD_MS,
    };
  }

  try {
    const currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${coords.lat}&lon=${coords.lon}&units=metric&appid=${OPENWEATHER_KEY}`;
    const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${coords.lat}&lon=${coords.lon}&units=metric&cnt=40&appid=${OPENWEATHER_KEY}`;

    const [currentRes, forecastRes] = await Promise.all([
      fetch(currentUrl, { signal: AbortSignal.timeout(10_000) }),
      fetch(forecastUrl, { signal: AbortSignal.timeout(10_000) }),
    ]);

    if (!currentRes.ok || !forecastRes.ok) {
      if (cached) return { ...cached.data, stale: true };
      return null;
    }

    const currentData = (await currentRes.json()) as OpenWeatherCurrent;
    const forecastData = (await forecastRes.json()) as OpenWeatherForecast;

    const now = new Date().toISOString();

    const row: WeatherLocationRow = {
      location_id: `weather-${county.id}`,
      name: `${county.name} County`,
      level: 'county',
      payam_id: null,
      payam_name: null,
      county_id: county.id,
      county_name: county.name,
      state_id: county.state_id,
      latitude: coords.lat,
      longitude: coords.lon,
      fetched_at: now,
      stale: false,
      current: {
        observed_at: currentData.dt
          ? new Date(currentData.dt * 1000).toISOString()
          : null,
        temp_c: currentData.main?.temp ?? 0,
        humidity_pct: currentData.main?.humidity ?? 0,
        wind_kph: (currentData.wind?.speed ?? 0) * 3.6,
        rain_mm: currentData.rain?.['1h'] ?? currentData.rain?.['3h'] ?? 0,
        conditions: currentData.weather?.[0]?.description ?? '',
        icon: currentData.weather?.[0]?.icon ?? null,
      },
      forecast: extractDailyForecast(forecastData),
    };

    cache.set(county.id, { data: row, fetchedAt: Date.now() });
    return row;
  } catch {
    if (cached) return { ...cached.data, stale: true };
    return null;
  }
}

interface OpenWeatherCurrent {
  dt?: number;
  main?: { temp: number; humidity: number };
  wind?: { speed: number };
  rain?: { '1h'?: number; '3h'?: number };
  weather?: Array<{ description: string; icon: string }>;
}

interface OpenWeatherForecast {
  list?: Array<{
    dt: number;
    main: { temp: number; temp_min: number; temp_max: number; humidity: number };
    wind: { speed: number };
    rain?: { '3h'?: number };
    pop?: number;
    weather?: Array<{ description: string; icon: string }>;
  }>;
}

function extractDailyForecast(
  data: OpenWeatherForecast,
): WeatherLocationRow['forecast'] {
  if (!data.list?.length) return [];

  const days = new Map<
    string,
    {
      temps: number[];
      mins: number[];
      maxes: number[];
      rain: number;
      pop: number[];
      humidity: number[];
      wind: number[];
      conditions: string;
      icon: string | null;
    }
  >();

  const today = new Date().toISOString().slice(0, 10);

  for (const item of data.list) {
    const date = new Date(item.dt * 1000).toISOString().slice(0, 10);
    if (date === today) continue;

    let day = days.get(date);
    if (!day) {
      day = {
        temps: [],
        mins: [],
        maxes: [],
        rain: 0,
        pop: [],
        humidity: [],
        wind: [],
        conditions: '',
        icon: null,
      };
      days.set(date, day);
    }
    day.temps.push(item.main.temp);
    day.mins.push(item.main.temp_min);
    day.maxes.push(item.main.temp_max);
    day.rain += item.rain?.['3h'] ?? 0;
    if (item.pop !== undefined) day.pop.push(item.pop);
    day.humidity.push(item.main.humidity);
    day.wind.push(item.wind.speed * 3.6);
    if (item.weather?.[0]) {
      day.conditions = item.weather[0].description;
      day.icon = item.weather[0].icon;
    }
  }

  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 5)
    .map(([date, d]) => ({
      forecast_for: date,
      temp_max_c: Math.max(...d.maxes),
      temp_min_c: Math.min(...d.mins),
      rain_mm: Math.round(d.rain * 10) / 10,
      rain_probability:
        d.pop.length > 0
          ? Math.round(Math.max(...d.pop) * 100) / 100
          : 0,
      humidity_pct: Math.round(
        d.humidity.reduce((a, b) => a + b, 0) / d.humidity.length,
      ),
      wind_kph: Math.round(
        (d.wind.reduce((a, b) => a + b, 0) / d.wind.length) * 10,
      ) / 10,
      conditions: d.conditions,
      icon: d.icon,
    }));
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [...ALL_ROLES],
    handler: async ({ auth }) => {
      if (!OPENWEATHER_KEY) return ok([]);

      const counties = await scopedCounties(auth.scope);
      const locations = (
        await Promise.all(counties.map(fetchWeatherForCounty))
      ).filter((r): r is WeatherLocationRow => r !== null);

      return ok(locations);
    },
  },
});

async function scopedCounties(
  scope: { kind: string; stateId?: string; payamId?: string },
): Promise<CountyRow[]> {
  if (scope.kind === 'all') {
    return prisma.$queryRawUnsafe<CountyRow[]>(
      'SELECT id, name, state_id FROM public.county WHERE deleted_at IS NULL',
    );
  }

  if (scope.kind === 'caseload' && scope.payamId) {
    const countyId = scope.payamId.split('-').slice(0, 2).join('-');
    return prisma.$queryRawUnsafe<CountyRow[]>(
      'SELECT id, name, state_id FROM public.county WHERE id = $1 AND deleted_at IS NULL',
      countyId,
    );
  }

  if (scope.stateId) {
    return prisma.$queryRawUnsafe<CountyRow[]>(
      'SELECT id, name, state_id FROM public.county WHERE state_id = $1 AND deleted_at IS NULL',
      scope.stateId,
    );
  }

  return [];
}
