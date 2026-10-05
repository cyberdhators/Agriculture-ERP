'use client';

import { useEffect, useMemo, useState } from 'react';

import type { LearningTopic } from '@agri-erp/shared';

import { UnavailableState } from '@/components/ui/data';
import { Button } from '@/components/ui';
import { getLearningResourceLink, listLearningResources, LIVE_LIBRARY } from '@/lib/library/api';
import { useWeather } from '@/lib/weather/api';
import { usePreview } from '@/lib/preview';
import {
  CROP_LABELS,
  FORMAT_LABELS,
  LANGUAGE_LABELS,
  TOPIC_LABELS,
  formatBytes,
} from '@/lib/format';
import {
  byTopic,
  currentReadings,
  forecastDays,
  resourceFacts,
  topicsPresent,
  weatherState,
  type ResourceRow,
} from '@/lib/officer/learning';

import styles from './officer-learning.module.css';

/**
 * THE OFFICER'S REFERENCE SHELF.
 *
 * Two things, because two things are what the backend actually offers an
 * officer: the weather recorded for their county, and the published learning
 * library. Both are read-only, both are already scoped by the server, and
 * neither is narrowed again here.
 *
 * THEY FAIL SEPARATELY, ON PURPOSE. The weather route and the library route
 * are independent, so one being unreachable must not blank the other. Each
 * section owns its own loading, empty and error state; there is no page-level
 * failure.
 *
 * NO DIRECTORY. `GET /api/directory-entries` exists and IS officer-safe --
 * state-scoped and active-only -- but the owner withdrew the directory module
 * from the redesigned navigation (see the note in lib/portal/nav.ts). A
 * destination the owner removed is not one this screen restores; the route and
 * its data are untouched, so restoring it is a decision, not a rebuild.
 *
 * NO REPORTING SUMMARY. `GET /api/reports/summary` is officer-scoped and would
 * work, but the officer's dashboard already answers the same questions from
 * `GET /api/farmers` and `GET /api/visits`. Two figures for one question, each
 * counted a different way, is worse than one -- so the count lives on the
 * dashboard and this screen does not repeat it.
 *
 * NOTHING IS CACHED HERE. No storage, no queue, no service worker. Where the
 * SERVER tells us its data is old, that is shown, because that is a fact it
 * reported -- not an offline mode this screen invented.
 */
export function OfficerLearning() {
  const { me } = usePreview();
  const payamId = me?.scope?.kind === 'caseload' ? me.scope.payamId : null;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Learning &amp; weather</h1>
      <p className={styles.sub}>Reference for the field. Everything here is read-only.</p>

      <WeatherCard payamId={payamId} />
      <LibrarySection />
    </div>
  );
}

/**
 * THE WEATHER FOR THE OFFICER'S OWN PLACE.
 *
 * `GET /api/weather` takes no parameters and returns the locations the caller
 * may see -- for an officer, their county. The payam from the session picks the
 * nearest row; the browser's geolocation is NOT used, because the contract
 * neither asks for nor accepts a position.
 *
 * THE ROUTE NEVER FETCHES (C-16.6). It serves the last stored observation, so
 * the moment it was taken is always shown and the word "live" is never used.
 */
function WeatherCard({ payamId }: { payamId: string | null }) {
  const { loading, error, location, attribution } = useWeather(payamId);
  const state = weatherState(location);
  const readings = currentReadings(location);
  const days = forecastDays(location);

  return (
    <section className={styles.card} aria-labelledby="weather-h">
      <h2 id="weather-h" className={styles.cardHead}>
        Weather
      </h2>

      {loading ? (
        <p className={styles.note} aria-busy="true">
          Reading the weather…
        </p>
      ) : error ? (
        // Compact and local: the library below is unaffected.
        <p className={styles.problem} role="status">
          The weather could not be read just now. Everything else on this page still works.
        </p>
      ) : state.kind === 'none' ? (
        <p className={styles.note}>No weather is recorded for your area yet.</p>
      ) : (
        <>
          <p className={styles.place}>{location?.name}</p>
          {location?.current?.conditions ? (
            <p className={styles.conditions}>{location.current.conditions}</p>
          ) : null}

          {/*
            Said in WORDS as well as colour: a stale row is not distinguished
            by a tint alone.
          */}
          <p className={state.kind === 'stale' ? styles.stale : styles.recorded}>
            {state.kind === 'stale' ? 'Older than it should be · ' : ''}
            Recorded {state.fetchedAt ? stamp(state.fetchedAt) : 'at an unknown time'}
          </p>

          {readings.length > 0 ? (
            <dl className={styles.readings}>
              {readings.map((reading) => (
                <div key={reading.label}>
                  <dt>{reading.label}</dt>
                  <dd className="mono">{reading.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className={styles.note}>No measurements were recorded for this place.</p>
          )}

          {days.length > 0 ? (
            <ul className={styles.days}>
              {days.map((day) => (
                <li key={day.forecast_for} className={styles.day}>
                  <span className={styles.dayName}>{dayName(day.forecast_for)}</span>
                  <span className="mono">
                    {day.temp_min_c}–{day.temp_max_c}°C
                  </span>
                  <span className={styles.dayRain}>{day.rain_probability}% rain</span>
                </li>
              ))}
            </ul>
          ) : null}

          {/* A licence condition, not decoration. The server owns the wording. */}
          <p className={styles.attribution}>
            <a href={attribution.url} target="_blank" rel="noopener noreferrer">
              {attribution.text}
            </a>
          </p>
        </>
      )}
    </section>
  );
}

/**
 * THE PUBLISHED LIBRARY.
 *
 * The route adds `published = true` for any caller whose scope is not `all`,
 * so an officer's list is the published library and this screen adds no filter
 * of its own beyond the topic the officer picks.
 *
 * A RESOURCE CANNOT BE OPENED YET. Rows carry `storage_path`, but there is no
 * route that turns one into a readable link -- visit attachments have one,
 * learning resources do not. Building a URL from the path would produce a
 * broken link; guessing a public address would invent a capability the backend
 * does not offer. So the shelf lists what exists and says so plainly.
 */
function LibrarySection() {
  const [rows, setRows] = useState<readonly ResourceRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [topic, setTopic] = useState<LearningTopic | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<Record<string, string>>({});

  /**
   * ONE LINK, WHEN THE OFFICER ASKS FOR IT.
   *
   * Issuing a read link is an access event and is audited, so links are never
   * fetched for the list: a link obtained because a page rendered would record
   * a reading nobody did. This runs on the tap and on nothing else.
   *
   * A failure belongs to its own row. The shelf stays usable and the row goes
   * back to being openable, so a second tap is a real second attempt.
   */
  async function open(id: string) {
    setOpenError((was) => {
      const next = { ...was };
      delete next[id];
      return next;
    });
    setOpening(id);
    try {
      const link = await getLearningResourceLink(id);
      window.open(link.url, '_blank', 'noopener,noreferrer');
    } catch (failure) {
      const status = (failure as { status?: number })?.status;
      setOpenError((was) => ({
        ...was,
        [id]:
          status === 404
            ? 'This resource is no longer available.'
            : 'Unable to open this resource. Try again.',
      }));
    } finally {
      setOpening(null);
    }
  }

  useEffect(() => {
    if (!LIVE_LIBRARY) {
      setFailed(true);
      return;
    }
    let on = true;
    listLearningResources()
      .then((list) => on && setRows(list as unknown as ResourceRow[]))
      .catch(() => on && setFailed(true));
    return () => {
      on = false;
    };
  }, []);

  const topics = useMemo(() => topicsPresent(rows ?? []), [rows]);
  const shown = useMemo(() => byTopic(rows ?? [], topic), [rows, topic]);

  return (
    <section className={styles.card} aria-labelledby="library-h">
      <h2 id="library-h" className={styles.cardHead}>
        Learning library
      </h2>

      {failed ? (
        <p className={styles.problem} role="status">
          {LIVE_LIBRARY
            ? 'The library could not be read just now. The weather above still works.'
            : 'This deployment is running on preview data, so no resources are read.'}
        </p>
      ) : rows === null ? (
        <p className={styles.note} aria-busy="true">
          Loading the library…
        </p>
      ) : rows.length === 0 ? (
        <UnavailableState title="No learning resources available">
          Nothing has been published to the library yet. This is what the server returned, not a
          problem with your connection.
        </UnavailableState>
      ) : (
        <>
          {topics.length > 1 ? (
            <div className={styles.topics} role="group" aria-label="Filter by topic">
              <button
                type="button"
                className={`${styles.topic} ${topic === null ? styles.topicOn : ''}`}
                aria-pressed={topic === null}
                onClick={() => setTopic(null)}
              >
                All
              </button>
              {topics.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`${styles.topic} ${topic === option ? styles.topicOn : ''}`}
                  aria-pressed={topic === option}
                  onClick={() => setTopic(option)}
                >
                  {TOPIC_LABELS[option]}
                </button>
              ))}
            </div>
          ) : null}

          <ul className={styles.list}>
            {shown.map((row) => (
              <li key={row.id} className={styles.resource}>
                <span className={styles.resourceTitle} dir="auto">
                  {row.title}
                </span>
                <span className={styles.resourceTopic}>{TOPIC_LABELS[row.topic]}</span>
                {row.description ? (
                  <span className={styles.resourceBody} dir="auto">
                    {row.description}
                  </span>
                ) : null}
                <span className={styles.resourceFacts}>
                  {resourceFacts(row, {
                    format: FORMAT_LABELS,
                    language: LANGUAGE_LABELS,
                    crop: CROP_LABELS,
                    size: formatBytes,
                  }).join(' · ')}
                </span>
                {/*
                  The link is asked for on the tap, never in advance. The
                  browser opens whatever came back -- there is no viewer here
                  and no assumption that a resource is a PDF.
                */}
                <Button
                  type="button"
                  variant="secondary"
                  className={styles.openResource}
                  disabled={opening === row.id}
                  onClick={() => void open(row.id)}
                >
                  {opening === row.id ? 'Opening…' : 'Open resource'}
                </Button>
                {openError[row.id] ? (
                  <span className={styles.rowError} role="alert">
                    {openError[row.id]}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>

          <p className={styles.note}>
            Opening a resource fetches it over your current connection. Nothing is kept on this
            phone.
          </p>
        </>
      )}
    </section>
  );
}

function stamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dayName(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short' });
}
