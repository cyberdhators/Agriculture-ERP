import {
  LEARNING_TOPICS,
  type Crop,
  type Language,
  type LearningTopic,
  type ResourceFormat,
} from '@agri-erp/shared';

import type { WeatherLocation } from '@/lib/weather/api';

/**
 * THE OFFICER'S REFERENCE SHELF, AS A MODEL.
 *
 * Everything here arranges what `GET /api/learning-resources` and
 * `GET /api/weather` actually returned. Nothing is fetched from a third party,
 * nothing is cached locally, and nothing is invented.
 *
 * WHAT THE OFFICER IS ALLOWED TO SEE IS THE SERVER'S DECISION. The learning
 * route adds `published = true` for any caller whose scope is not `all`, so an
 * officer's list is the published library and the constraint is the ROLE, not
 * a filter this screen chose. The weather route returns the locations for the
 * caller's county. Neither is narrowed again here.
 */

/** The canonical topics, re-exported. Never listed a second time. */
export const TOPICS = LEARNING_TOPICS;

export interface ResourceRow {
  id: string;
  title: string;
  topic: LearningTopic;
  crop: Crop | null;
  language: Language;
  format: ResourceFormat;
  storage_path: string;
  byte_size: number;
  description: string | null;
  published: boolean;
  uploaded_at: string;
}

/**
 * THE LIBRARY CANNOT BE OPENED, AND THIS RECORDS WHY.
 *
 * A resource row carries `storage_path`, and the bucket behind it is private
 * exactly as the visit-attachment bucket is. Attachments have a route that
 * issues a short-lived read link (`.../attachments/:aid/link`,
 * `issueReadLink`); learning resources have NO equivalent -- there is no GET on
 * `/api/learning-resources/:id` at all, only an administrator's PATCH and
 * DELETE.
 *
 * So a storage path is not an address. Turning one into a URL on the client
 * would produce a link that cannot work, and guessing a public bucket URL
 * would be inventing a capability the backend deliberately does not offer.
 * The screen therefore shows what a resource IS and says plainly that it
 * cannot be opened yet. This is a backend contract gap, reported as one.
 */
export const RESOURCE_OPENING_SUPPORTED = false;

export const byTopic = (
  resources: readonly ResourceRow[],
  topic: LearningTopic | null,
): ResourceRow[] => (topic === null ? [...resources] : resources.filter((r) => r.topic === topic));

/** Only the topics that actually have something behind them. */
export function topicsPresent(resources: readonly ResourceRow[]): LearningTopic[] {
  const seen = new Set(resources.map((r) => r.topic));
  return TOPICS.filter((topic) => seen.has(topic));
}

/**
 * The line of facts under a resource title, built ONLY from keys the route
 * sent. A null crop is left out rather than printed as "none": a resource
 * about storage is not about no crop, it is simply not crop-specific.
 */
export function resourceFacts(
  row: ResourceRow,
  labels: {
    format: Record<ResourceFormat, string>;
    language: Record<Language, string>;
    crop: Record<Crop, string>;
    size: (bytes: number) => string;
  },
): string[] {
  const facts = [labels.format[row.format], labels.language[row.language]];
  if (row.crop !== null) facts.push(labels.crop[row.crop]);
  if (row.byte_size > 0) facts.push(labels.size(row.byte_size));
  return facts;
}

/* ---- Weather ----------------------------------------------------------- */

export interface Reading {
  label: string;
  value: string;
}

/**
 * The current conditions, as READINGS THAT EXIST.
 *
 * Every field on `current` is nullable and the whole object can be null. A
 * missing temperature is not 0 °C and a missing rainfall is not a dry day, so
 * an absent reading produces no row at all rather than a zero. The screen then
 * shows what was measured and says nothing about what was not.
 */
export function currentReadings(location: WeatherLocation | null): Reading[] {
  const current = location?.current;
  if (!current) return [];
  const readings: Reading[] = [];
  if (current.temp_c !== null)
    readings.push({ label: 'Temperature', value: `${current.temp_c}°C` });
  if (current.rain_mm !== null) readings.push({ label: 'Rain', value: `${current.rain_mm} mm` });
  if (current.wind_kph !== null)
    readings.push({ label: 'Wind', value: `${current.wind_kph} km/h` });
  if (current.humidity_pct !== null) {
    readings.push({ label: 'Humidity', value: `${current.humidity_pct}%` });
  }
  return readings;
}

/**
 * WHAT THE WEATHER IS, HONESTLY.
 *
 * `GET /api/weather` NEVER FETCHES (C-16.6): it serves the last observation
 * stored for the caller's locations. So this information is always a recording
 * of some earlier moment, and `fetched_at` is that moment -- deliberately the
 * real one, never `now()`. `stale` is the server saying the last fetch failed
 * and the row is older than it should be.
 *
 * The word "live" appears nowhere, because nothing here is live.
 */
export interface WeatherState {
  kind: 'none' | 'fresh' | 'stale';
  fetchedAt: string | null;
}

export function weatherState(location: WeatherLocation | null): WeatherState {
  if (!location) return { kind: 'none', fetchedAt: null };
  return { kind: location.stale ? 'stale' : 'fresh', fetchedAt: location.fetched_at };
}

/** The next few days, as the route sent them. Never extrapolated. */
export const forecastDays = (location: WeatherLocation | null, days = 3) =>
  (location?.forecast ?? []).slice(0, days);
