import { describe, expect, it } from 'vitest';

import {
  aggregateDaily,
  isStale,
  localDate,
  metresPerSecondToKph,
  openWeatherForecastSchema,
  weatherLocationSeedSchema,
  WEATHER_FORECAST_DAYS,
  WEATHER_STALE_AFTER_HOURS,
} from '../src/weather';

/**
 * The aggregation is the one piece of C-16 that turns provider data into what a
 * farmer's officer sees, so it is proved here with no network: a response in
 * the provider's shape, built by hand so every expected number is known.
 *
 * Juba is UTC+2 (timezone 7200). "Now" is fixed at 2026-09-15T10:00:00Z, which
 * is 12:00 local on the 15th, so the 15th is today and must be dropped.
 */
const TZ = 7200;
const NOW = new Date('2026-09-15T10:00:00Z');
const at = (isoLocal: string) =>
  Math.floor((new Date(`${isoLocal}Z`).getTime() - TZ * 1000) / 1000);
const slot = (
  isoLocal: string,
  temp: number,
  o: Partial<{
    hum: number;
    wind: number;
    pop: number;
    rain: number;
    desc: string;
    icon: string;
  }> = {},
) => ({
  dt: at(isoLocal),
  main: { temp, humidity: o.hum ?? 60 },
  wind: { speed: o.wind ?? 3 },
  pop: o.pop ?? 0,
  ...(o.rain !== undefined ? { rain: { '3h': o.rain } } : {}),
  weather: [{ description: o.desc ?? 'clear sky', icon: o.icon ?? '01d' }],
});

const FIXTURE = openWeatherForecastSchema.parse({
  city: { timezone: TZ },
  list: [
    // Today (local 15th) -- the leftover evening; must be excluded.
    slot('2026-09-15T15:00:00', 33),
    slot('2026-09-15T21:00:00', 24),
    // Tomorrow (16th): a rainy day with a clear midday.
    slot('2026-09-16T00:00:00', 22, {
      hum: 80,
      wind: 2,
      pop: 0.2,
      desc: 'light rain',
      icon: '10n',
    }),
    slot('2026-09-16T06:00:00', 23, {
      hum: 78,
      wind: 4,
      pop: 0.6,
      rain: 1.5,
      desc: 'light rain',
      icon: '10d',
    }),
    slot('2026-09-16T12:00:00', 31, { hum: 55, wind: 5, pop: 0.3, desc: 'clear sky', icon: '01d' }),
    slot('2026-09-16T18:00:00', 27, {
      hum: 70,
      wind: 3,
      pop: 0.9,
      rain: 6.9,
      desc: 'light rain',
      icon: '10d',
    }),
    // The 17th: hot and dry, one slot.
    slot('2026-09-17T12:00:00', 36, { hum: 30, wind: 6, pop: 0, desc: 'clear sky', icon: '01d' }),
  ],
});

describe('aggregateDaily (C-16.1, forecasts are numbers)', () => {
  const days = aggregateDaily(FIXTURE, NOW);

  it("starts tomorrow in the location's own timezone and ascends", () => {
    expect(days.map((d) => d.forecast_for)).toEqual(['2026-09-16', '2026-09-17']);
  });

  it('computes max and min from every slot of the day', () => {
    expect(days[0]!.temp_max_c).toBe(31);
    expect(days[0]!.temp_min_c).toBe(22);
  });

  it("sums rain, takes the day's highest probability, averages humidity, takes the strongest wind in km/h", () => {
    expect(days[0]!.rain_mm).toBe(8.4);
    expect(days[0]!.rain_probability).toBe(0.9);
    expect(days[0]!.humidity_pct).toBe(70.8);
    expect(days[0]!.wind_kph).toBe(18); // 5 m/s * 3.6
  });

  it('names the most frequent conditions and the midday icon, not the night one', () => {
    expect(days[0]!.conditions).toBe('light rain');
    expect(days[0]!.icon).toBe('01d');
    expect(days[0]!.slots).toBe(4);
  });

  it('never returns more than the product provides', () => {
    expect(days.length).toBeLessThanOrEqual(WEATHER_FORECAST_DAYS);
  });

  it('puts a slot at 23:00 local on its own day, where UTC would move it to the next', () => {
    // 23:00 Juba is 21:00 UTC, same date; 01:00 Juba is 23:00 UTC the day BEFORE.
    expect(localDate(at('2026-09-16T01:00:00'), TZ)).toBe('2026-09-16');
    expect(localDate(at('2026-09-16T01:00:00'), 0)).toBe('2026-09-15');
  });
});

describe('the small pure pieces', () => {
  it('converts wind to km/h to one decimal', () => {
    expect(metresPerSecondToKph(5)).toBe(18);
    expect(metresPerSecondToKph(3.33)).toBe(12);
  });

  it('marks a row stale after the window and not before (C-16.7)', () => {
    const now = new Date('2026-09-15T12:00:00Z');
    const fresh = new Date(now.getTime() - (WEATHER_STALE_AFTER_HOURS - 1) * 3600_000);
    const old = new Date(now.getTime() - (WEATHER_STALE_AFTER_HOURS + 1) * 3600_000);
    expect(isStale(fresh, now)).toBe(false);
    expect(isStale(old, now)).toBe(true);
  });

  it('refuses a location whose level and payam disagree (C-16.2: explicit, never a null that means something)', () => {
    const base = {
      name: 'Juba County',
      state_id: 'CE',
      county_id: 'CE-JUB',
      latitude: 4.85,
      longitude: 31.6,
    };
    expect(
      weatherLocationSeedSchema.safeParse({ ...base, level: 'county', payam_id: null }).success,
    ).toBe(true);
    expect(
      weatherLocationSeedSchema.safeParse({ ...base, level: 'payam', payam_id: 'CE-JUB-MUN' })
        .success,
    ).toBe(true);
    expect(
      weatherLocationSeedSchema.safeParse({ ...base, level: 'county', payam_id: 'CE-JUB-MUN' })
        .success,
    ).toBe(false);
    expect(
      weatherLocationSeedSchema.safeParse({ ...base, level: 'payam', payam_id: null }).success,
    ).toBe(false);
  });
});
