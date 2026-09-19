import { z } from 'zod';

/**
 * C-16 -- the weather tile. Shared between the fetch job, the route and any
 * client, so none of them can disagree about what a forecast row is.
 *
 * WHAT IS HERE AND WHAT IS NOT. The provider's shapes are here only as far as
 * the aggregation needs them. Nothing here renders a sentence: forecasts are
 * numbers (C-16.1). Nothing here fetches: reads read the cache and a scheduled
 * job fills it (C-16.6).
 */

/** OpenWeather requires this visible wherever the data is shown; the route serves it (C-16.10). */
export const WEATHER_ATTRIBUTION = {
  text: 'Weather data provided by OpenWeather',
  url: 'https://openweathermap.org',
  logo_required: true,
} as const;

/**
 * A row older than this is served with `stale: true` rather than hidden
 * (C-16.7). One fetch per location per day plus two hours of slack for the job
 * to run late: a row fetched yesterday morning is fine this morning and stale
 * this evening.
 */
export const WEATHER_STALE_AFTER_HOURS = 26;

/** A manual refresh cannot fetch the same location twice inside this window (C-16.7). */
export const WEATHER_REFETCH_FLOOR_MINUTES = 60;

/** The free 5-day / 3-hour product yields at most this many whole days after today. */
export const WEATHER_FORECAST_DAYS = 5;

/** OpenWeather's free plan: 60 calls per minute. The job paces under it (C-16.6). */
export const WEATHER_CALLS_PER_MINUTE_CEILING = 50;

export const WEATHER_LOCATION_LEVELS = ['county', 'payam'] as const;
export type WeatherLocationLevel = (typeof WEATHER_LOCATION_LEVELS)[number];

/** One seeded location. County level to start (C-16.13); a payam-level row names its payam. */
export const weatherLocationSeedSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    level: z.enum(WEATHER_LOCATION_LEVELS),
    state_id: z.string().trim().min(1),
    county_id: z.string().trim().min(1),
    payam_id: z.string().trim().min(1).nullable(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .refine((v) => (v.level === 'payam') === (v.payam_id !== null), {
    message: 'A payam-level location names its payam; a county-level one has no payam.',
    path: ['payam_id'],
  });
export type WeatherLocationSeed = z.infer<typeof weatherLocationSeedSchema>;

/** The slice of OpenWeather's 5-day / 3-hour response the aggregation reads. */
export const openWeatherForecastSchema = z.object({
  city: z.object({ timezone: z.number().int() }).passthrough(),
  list: z
    .array(
      z
        .object({
          dt: z.number().int(),
          main: z.object({ temp: z.number(), humidity: z.number() }).passthrough(),
          wind: z.object({ speed: z.number() }).passthrough(),
          pop: z.number().min(0).max(1).optional(),
          rain: z.object({ '3h': z.number() }).partial().optional(),
          weather: z.array(z.object({ description: z.string(), icon: z.string() }).passthrough()),
        })
        .passthrough(),
    )
    .min(1),
});
export type OpenWeatherForecast = z.infer<typeof openWeatherForecastSchema>;

/** The slice of OpenWeather's current-weather response the observation stores. */
export const openWeatherCurrentSchema = z.object({
  dt: z.number().int(),
  main: z.object({ temp: z.number(), humidity: z.number() }).passthrough(),
  wind: z.object({ speed: z.number() }).passthrough(),
  rain: z.object({ '1h': z.number() }).partial().optional(),
  weather: z.array(z.object({ description: z.string(), icon: z.string() }).passthrough()),
});
export type OpenWeatherCurrent = z.infer<typeof openWeatherCurrentSchema>;

export interface DailyForecast {
  /** Local calendar date, YYYY-MM-DD, in the location's own timezone. */
  forecast_for: string;
  temp_max_c: number;
  temp_min_c: number;
  /** Millimetres, summed over the day's three-hour slots. */
  rain_mm: number;
  /** The day's highest probability of precipitation, 0..1. */
  rain_probability: number;
  humidity_pct: number;
  /** Kilometres per hour; the provider gives metres per second. */
  wind_kph: number;
  /** The most frequent description across the day's slots, lower case. */
  conditions: string;
  /** The icon of the slot nearest local midday, or the most frequent. */
  icon: string;
  /** The slots this row was computed from, kept as the provider gave them (C-16.1 `raw`). */
  slots: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
export const metresPerSecondToKph = (ms: number) => round1(ms * 3.6);

/** YYYY-MM-DD of a unix time shifted into a fixed-offset timezone. */
export function localDate(unixSeconds: number, timezoneOffsetSeconds: number): string {
  return new Date((unixSeconds + timezoneOffsetSeconds) * 1000).toISOString().slice(0, 10);
}

/**
 * Three-hour slots -> whole days, in the LOCATION'S timezone, starting TOMORROW.
 *
 * Why tomorrow: the contract says the forecast is ascending from tomorrow, and
 * the remaining slots of today are a partial day whose max/min would mislead --
 * a row for today with only the evening left in it reads as a cold day.
 *
 * Why the location's timezone and not UTC: a day boundary in UTC is 03:00 in
 * Juba. Grouping by UTC would put a Juba evening into the next day's row.
 *
 * Pure. Tested against a recorded provider response, with no network.
 */
export function aggregateDaily(
  forecast: OpenWeatherForecast,
  now: Date = new Date(),
): DailyForecast[] {
  const tz = forecast.city.timezone;
  const today = localDate(Math.floor(now.getTime() / 1000), tz);
  const byDay = new Map<string, OpenWeatherForecast['list']>();
  for (const slot of forecast.list) {
    const day = localDate(slot.dt, tz);
    if (day <= today) continue;
    const list = byDay.get(day) ?? [];
    list.push(slot);
    byDay.set(day, list);
  }
  const out: DailyForecast[] = [];
  for (const [day, slots] of [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const temps = slots.map((s) => s.main.temp);
    const descriptions = new Map<string, number>();
    const icons = new Map<string, number>();
    for (const s of slots) {
      const d = s.weather[0]?.description.toLowerCase() ?? 'unknown';
      descriptions.set(d, (descriptions.get(d) ?? 0) + 1);
      const i = s.weather[0]?.icon ?? '';
      icons.set(i, (icons.get(i) ?? 0) + 1);
    }
    const mostFrequent = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '';
    // Prefer the slot nearest local midday for the icon: a day's picture is its
    // daytime, and a night icon on a sunny day would mislead.
    const midday = slots
      .map((s) => ({ s, dist: Math.abs(((s.dt + tz) % 86400) - 43200) }))
      .sort((a, b) => a.dist - b.dist)[0]?.s;
    out.push({
      forecast_for: day,
      temp_max_c: round1(Math.max(...temps)),
      temp_min_c: round1(Math.min(...temps)),
      rain_mm: round1(slots.reduce((acc, s) => acc + (s.rain?.['3h'] ?? 0), 0)),
      rain_probability: round2(Math.max(...slots.map((s) => s.pop ?? 0))),
      humidity_pct: round1(slots.reduce((acc, s) => acc + s.main.humidity, 0) / slots.length),
      wind_kph: metresPerSecondToKph(Math.max(...slots.map((s) => s.wind.speed))),
      conditions: mostFrequent(descriptions),
      icon: midday?.weather[0]?.icon ?? mostFrequent(icons),
      slots: slots.length,
    });
  }
  return out.slice(0, WEATHER_FORECAST_DAYS);
}

/** Whether a row fetched at `fetchedAt` should be served as stale (C-16.7). */
export const isStale = (fetchedAt: Date, now: Date = new Date()): boolean =>
  now.getTime() - fetchedAt.getTime() > WEATHER_STALE_AFTER_HOURS * 3600 * 1000;
