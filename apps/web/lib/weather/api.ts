'use client';

import { useEffect, useMemo, useState } from 'react';

import { pickLocation } from './pick';

/**
 * Client data layer for the weather tile (C-16), written to the route
 * contract agreed before either half existed: docs/api/weather-contract.md
 * (#78). GET /api/weather, no parameters; the server scopes by role; a caller
 * with no locations gets 200 and an empty list, which is a normal state and
 * renders as "no weather location for your area yet", never as an error.
 * The route never renders a sentence — numbers and provider strings only —
 * so wording lives here. Gated by NEXT_PUBLIC_USE_LIVE_WEATHER (off =
 * the fixture below, one county-level row, plainly invented).
 */
export const LIVE_WEATHER = process.env.NEXT_PUBLIC_USE_LIVE_WEATHER === '1';

export interface WeatherCurrent {
  temp_c: number;
  humidity_pct: number;
  wind_kph: number;
  rain_mm: number;
  conditions: string;
  icon: string | null;
}

export interface WeatherDay {
  forecast_for: string;
  temp_max_c: number;
  temp_min_c: number;
  rain_mm: number;
  rain_probability: number;
  conditions: string;
  icon: string | null;
}

export interface WeatherLocation {
  location_id: string;
  payam_id: string;
  payam_name: string;
  county_id: string;
  state_id: string;
  latitude: number;
  longitude: number;
  /** Always the real fetch time, never now(). Shown, deliberately. */
  fetched_at: string;
  /** The last fetch failed and this row is older than it should be. Served, not hidden. */
  stale: boolean;
  current: WeatherCurrent | null;
  forecast: WeatherDay[];
}

/** A licence condition, not decoration: rendered where the weather is shown. */
export interface WeatherAttribution {
  text: string;
  url: string;
  logo_required: boolean;
}

export interface WeatherResponse {
  data: WeatherLocation[];
  attribution: WeatherAttribution;
}

export class WeatherApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WeatherApiError';
  }
}

export async function listWeather(): Promise<WeatherResponse> {
  const res = await fetch('/api/weather', { headers: { accept: 'application/json' } });
  const body = (await res.json().catch(() => ({}))) as Partial<WeatherResponse> & {
    error?: { code: string; message: string };
  };
  if (!res.ok) {
    throw new WeatherApiError(
      res.status,
      body.error?.code ?? 'request_failed',
      body.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return {
    data: body.data ?? [],
    attribution: body.attribution ?? FIXTURE.attribution,
  };
}

/**
 * PLACEHOLDER, plainly invented: one county-level row for Juba county, so the
 * tile can be walked before the route exists. Figures are made up.
 */
export const FIXTURE: WeatherResponse = {
  data: [
    {
      location_id: '00000000-0000-4000-8000-00000000c16a',
      payam_id: 'CE-JUB-JUB',
      payam_name: 'Juba',
      county_id: 'CE-JUB',
      state_id: 'CE',
      latitude: 4.85,
      longitude: 31.58,
      fetched_at: '2026-09-15T05:00:00Z',
      stale: false,
      current: {
        temp_c: 29,
        humidity_pct: 68,
        wind_kph: 9,
        rain_mm: 0,
        conditions: 'scattered clouds',
        icon: '03d',
      },
      forecast: [
        {
          forecast_for: '2026-09-16',
          temp_max_c: 32,
          temp_min_c: 22,
          rain_mm: 6,
          rain_probability: 0.6,
          conditions: 'light rain',
          icon: '10d',
        },
        {
          forecast_for: '2026-09-17',
          temp_max_c: 31,
          temp_min_c: 22,
          rain_mm: 11,
          rain_probability: 0.7,
          conditions: 'rain',
          icon: '10d',
        },
        {
          forecast_for: '2026-09-18',
          temp_max_c: 33,
          temp_min_c: 23,
          rain_mm: 0,
          rain_probability: 0.1,
          conditions: 'clear sky',
          icon: '01d',
        },
      ],
    },
  ],
  attribution: {
    text: 'Weather data provided by OpenWeather',
    url: 'https://openweathermap.org',
    logo_required: true,
  },
};

export interface WeatherView {
  live: boolean;
  loading: boolean;
  error?: string;
  location: WeatherLocation | null;
  attribution: WeatherAttribution;
}

/** The one row for a farmer's place, or null when the route has none yet. */
export function useWeather(payamId: string | null): WeatherView {
  const [res, setRes] = useState<WeatherResponse | null>(LIVE_WEATHER ? null : FIXTURE);
  const [loading, setLoading] = useState(LIVE_WEATHER);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!LIVE_WEATHER) return;
    let on = true;
    listWeather()
      .then((r) => on && (setRes(r), setError(undefined)))
      .catch((e: unknown) => {
        if (on) setError(e instanceof Error ? e.message : 'Could not read the weather.');
      })
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, []);

  return useMemo(
    () => ({
      live: LIVE_WEATHER,
      loading,
      error,
      location: res && payamId ? pickLocation(res.data, payamId) : null,
      attribution: res?.attribution ?? FIXTURE.attribution,
    }),
    [res, payamId, loading, error],
  );
}
