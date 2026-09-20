'use client';

import { useEffect, useMemo, useState } from 'react';

import { pickLocation } from './pick';

/**
 * Client data layer for the weather tile (C-16). Calls the public
 * GET /api/weather/forecast?payam_id=... endpoint, which reads cached
 * weather data from the database — no auth required (weather is not
 * sensitive). The fetch job (scripts/weather-fetch.mjs) fills the cache
 * on a schedule; this only reads.
 */

const DEFAULT_ATTRIBUTION: WeatherAttribution = {
  text: 'Weather data provided by OpenWeather',
  url: 'https://openweathermap.org',
  logo_required: true,
};

export interface WeatherCurrent {
  observed_at: string | null;
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
  humidity_pct: number;
  wind_kph: number;
  conditions: string;
  icon: string | null;
}

export interface WeatherLocation {
  location_id: string;
  name: string;
  level: 'county' | 'payam';
  payam_id: string | null;
  payam_name: string | null;
  county_id: string;
  county_name: string;
  state_id: string;
  latitude: number;
  longitude: number;
  fetched_at: string;
  stale: boolean;
  current: WeatherCurrent | null;
  forecast: WeatherDay[];
}

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
    attribution: body.attribution ?? DEFAULT_ATTRIBUTION,
  };
}

export async function fetchFarmerWeather(payamId: string): Promise<WeatherResponse> {
  const res = await fetch(`/api/weather/forecast?payam_id=${encodeURIComponent(payamId)}`, {
    headers: { accept: 'application/json' },
  });
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
    attribution: body.attribution ?? DEFAULT_ATTRIBUTION,
  };
}

export interface WeatherView {
  loading: boolean;
  error?: string;
  location: WeatherLocation | null;
  attribution: WeatherAttribution;
}

export function useWeather(payamId: string | null): WeatherView {
  const [res, setRes] = useState<WeatherResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!payamId) {
      setLoading(false);
      return;
    }
    let on = true;
    setLoading(true);
    fetchFarmerWeather(payamId)
      .then((r) => on && (setRes(r), setError(undefined)))
      .catch((e: unknown) => {
        if (on) setError(e instanceof Error ? e.message : 'Could not read the weather.');
      })
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, [payamId]);

  return useMemo(
    () => ({
      loading,
      error,
      location: res && payamId ? pickLocation(res.data, payamId) : null,
      attribution: res?.attribution ?? DEFAULT_ATTRIBUTION,
    }),
    [res, payamId, loading, error],
  );
}
