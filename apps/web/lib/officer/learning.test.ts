import { describe, expect, it } from 'vitest';

import { LEARNING_TOPICS } from '@agri-erp/shared';

import {
  byTopic,
  currentReadings,
  forecastDays,
  resourceFacts,
  RESOURCE_OPENING_SUPPORTED,
  TOPICS,
  topicsPresent,
  weatherState,
  type ResourceRow,
} from './learning';
import type { WeatherLocation } from '@/lib/weather/api';
import { CROP_LABELS, FORMAT_LABELS, LANGUAGE_LABELS, formatBytes } from '@/lib/format';

const LABELS = {
  format: FORMAT_LABELS,
  language: LANGUAGE_LABELS,
  crop: CROP_LABELS,
  size: formatBytes,
};

const resource = (over: Partial<ResourceRow> = {}): ResourceRow =>
  ({
    id: 'r1',
    title: 'Striga control in sorghum',
    topic: LEARNING_TOPICS[0]!,
    crop: 'sorghum',
    language: 'en',
    format: 'pdf',
    storage_path: 'learning/r1.pdf',
    byte_size: 240_000,
    description: 'What to do when striga appears.',
    published: true,
    uploaded_at: '2026-09-01T00:00:00.000Z',
    ...over,
  }) as ResourceRow;

const location = (over: Partial<WeatherLocation> = {}): WeatherLocation =>
  ({
    location_id: 'w1',
    name: 'Juba County',
    level: 'county',
    payam_id: 'CE-JUB-MUN',
    payam_name: 'Munuki',
    county_id: 'CE-JUB',
    county_name: 'Juba',
    state_id: 'CE',
    latitude: 4.85,
    longitude: 31.58,
    fetched_at: '2026-09-21T06:00:00.000Z',
    stale: false,
    current: {
      observed_at: '2026-09-21T05:00:00.000Z',
      temp_c: 31,
      humidity_pct: 62,
      wind_kph: 9,
      rain_mm: 0,
      conditions: 'Light rain',
      icon: '10d',
    },
    forecast: [],
    ...over,
  }) as WeatherLocation;

describe('topics come from the canonical list', () => {
  it('is the shared array itself, never a second copy', () => {
    expect(TOPICS).toBe(LEARNING_TOPICS);
  });

  it('offers only topics that actually have a resource behind them', () => {
    const rows = [
      resource({ topic: LEARNING_TOPICS[0]! }),
      resource({ topic: LEARNING_TOPICS[2]! }),
    ];
    const present = topicsPresent(rows);
    expect(present).toEqual([LEARNING_TOPICS[0], LEARNING_TOPICS[2]]);
    // And in the canonical order, not the order they happened to arrive in.
    expect(present).toEqual(TOPICS.filter((t) => present.includes(t)));
  });

  it('filters by topic, and no topic means everything', () => {
    const rows = [
      resource({ id: 'a', topic: LEARNING_TOPICS[0]! }),
      resource({ id: 'b', topic: LEARNING_TOPICS[1]! }),
    ];
    expect(byTopic(rows, LEARNING_TOPICS[1]!).map((r) => r.id)).toEqual(['b']);
    expect(byTopic(rows, null)).toHaveLength(2);
  });
});

describe('a resource shows what the route sent, and nothing else', () => {
  it('labels format, language, crop and size with the canonical maps', () => {
    const facts = resourceFacts(resource(), LABELS);
    expect(facts).toContain(FORMAT_LABELS.pdf);
    expect(facts).toContain(LANGUAGE_LABELS.en);
    expect(facts).toContain(CROP_LABELS.sorghum);
  });

  it('a resource with NO crop says nothing about crops rather than "none"', () => {
    const facts = resourceFacts(resource({ crop: null }), LABELS);
    expect(facts.join(' ')).not.toMatch(/none|n\/a|—/i);
    expect(facts).not.toContain(CROP_LABELS.sorghum);
  });

  it('a zero byte size is not printed as a size', () => {
    const facts = resourceFacts(resource({ byte_size: 0 }), LABELS);
    expect(facts.some((f) => f.includes('B'))).toBe(false);
  });

  it('OPENING A RESOURCE IS NOT SUPPORTED BY THE BACKEND, and the model says so', () => {
    // There is no GET on /api/learning-resources/:id and no read-link route,
    // so a storage_path is not an address. This constant is the record of that.
    expect(RESOURCE_OPENING_SUPPORTED).toBe(false);
  });
});

describe('the weather is a recording, never a live reading', () => {
  it('reports the server’s own moment and its staleness', () => {
    expect(weatherState(location())).toEqual({
      kind: 'fresh',
      fetchedAt: '2026-09-21T06:00:00.000Z',
    });
    expect(weatherState(location({ stale: true })).kind).toBe('stale');
  });

  it('no location at all is its own state, not a stale one', () => {
    expect(weatherState(null)).toEqual({ kind: 'none', fetchedAt: null });
  });

  it('shows the readings that exist', () => {
    const readings = currentReadings(location());
    expect(readings.map((r) => r.label)).toEqual(['Temperature', 'Rain', 'Wind', 'Humidity']);
  });

  it('AN ABSENT READING IS NOT A ZERO — it produces no row at all', () => {
    const partial = location({
      current: {
        observed_at: null,
        temp_c: 28,
        humidity_pct: null,
        wind_kph: null,
        rain_mm: null,
        conditions: null,
        icon: null,
      },
    } as unknown as Partial<WeatherLocation>);
    const readings = currentReadings(partial);
    expect(readings.map((r) => r.label)).toEqual(['Temperature']);
    expect(readings.some((r) => r.value.startsWith('0'))).toBe(false);
  });

  it('a measured zero IS shown — nought millimetres of rain is a fact', () => {
    const readings = currentReadings(location());
    expect(readings.find((r) => r.label === 'Rain')?.value).toBe('0 mm');
  });

  it('no current observation means no readings, not empty ones', () => {
    expect(currentReadings(location({ current: null }))).toEqual([]);
    expect(currentReadings(null)).toEqual([]);
  });

  it('the forecast is what was sent, never extrapolated', () => {
    expect(forecastDays(location())).toEqual([]);
    expect(forecastDays(null)).toEqual([]);
  });
});
