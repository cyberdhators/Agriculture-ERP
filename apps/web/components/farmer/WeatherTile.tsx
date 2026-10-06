'use client';

import { useState } from 'react';

import { useWeather } from '@/lib/weather/api';
import { t } from '@/lib/i18n';

import styles from './farmer.module.css';

type Language = 'en' | 'ar';

/**
 * The farmer's weather, first thing on Home, full width on every screen. Built
 * to docs/api/weather-contract.md (#78): one place only, never a comparison
 * between neighbouring payams; a stale row is shown with its real time rather
 * than hidden; no location is a normal state, not an error; the provider's
 * credit sits where the weather is shown. "See full forecast" opens the next
 * days in place — no second page, no other locations.
 */
export function WeatherTile({
  payamId,
  language,
  forecastOpen = false,
}: {
  payamId: string;
  language: Language;
  forecastOpen?: boolean;
}) {
  const w = useWeather(payamId);
  const [open, setOpen] = useState(forecastOpen);
  const loc = w.location;
  // The route names the place (§9.1): a county row is "Juba County", a payam row
  // its payam with the county beside it. One place, never two side by side.
  const place = !loc
    ? ''
    : loc.level === 'payam' && loc.payam_name
      ? `${loc.payam_name}, ${loc.county_name}`
      : loc.name;

  return (
    <section className={styles.weatherHero} aria-label={t('weather.title', language)}>
      {w.loading ? (
        <p className={styles.weatherHeroNote}>{t('weather.loading', language)}</p>
      ) : w.error ? (
        <p className={styles.weatherHeroNote}>{t('weather.unavailable', language)}</p>
      ) : !loc ? (
        <p className={styles.weatherHeroNote}>{t('weather.none', language)}</p>
      ) : (
        <>
          <div className={styles.weatherHeroTop}>
            <div className={styles.weatherHeroGlyph} aria-hidden>
              <WeatherGlyph conditions={loc.current?.conditions ?? ''} />
            </div>
            <div className={styles.weatherHeroText}>
              <span className={styles.weatherHeroPlace} dir="auto">
                {place}
              </span>
              {loc.current ? (
                <>
                  <span className={styles.weatherHeroCond} dir="auto">
                    {loc.current.conditions}
                  </span>
                  <span className={styles.weatherHeroFacts}>
                    {t('weather.humidity', language)} {loc.current.humidity_pct}% ·{' '}
                    {t('weather.rain', language)} {loc.current.rain_mm} mm ·{' '}
                    {t('weather.wind', language)} {Math.round(loc.current.wind_kph)} km/h
                  </span>
                </>
              ) : (
                <span className={styles.weatherHeroCond}>{t('weather.noReading', language)}</span>
              )}
            </div>
            {loc.current ? (
              <span className={styles.weatherHeroTemp}>{Math.round(loc.current.temp_c)}°</span>
            ) : null}
          </div>

          <div className={styles.weatherHeroBar}>
            <span className={styles.weatherHeroMeta}>
              {loc.stale ? `${t('weather.stale', language)} · ` : ''}
              {t('weather.asOf', language)} {timeOf(loc.fetched_at, language)}
            </span>
            {loc.forecast.length > 0 ? (
              <button
                type="button"
                className={styles.weatherHeroBtn}
                aria-expanded={open}
                aria-controls="weather-days"
                onClick={() => setOpen((o) => !o)}
              >
                {open ? t('weather.hideForecast', language) : t('weather.seeForecast', language)}
              </button>
            ) : null}
          </div>

          {open && loc.forecast.length > 0 ? (
            <ol
              id="weather-days"
              className={styles.weatherDays}
              aria-label={t('weather.next', language)}
            >
              {loc.forecast.slice(0, 7).map((d) => (
                <li key={d.forecast_for} className={styles.weatherDay}>
                  <span className={styles.weatherDayName}>{dayName(d.forecast_for, language)}</span>
                  <span className={styles.weatherDayTemp}>
                    {Math.round(d.temp_max_c)}° <span>/ {Math.round(d.temp_min_c)}°</span>
                  </span>
                  <span className={styles.weatherDayRain}>
                    {t('weather.rainChance', language)} {Math.round(d.rain_probability * 100)}%
                  </span>
                  <span className={styles.weatherDayCond} dir="auto">
                    {d.conditions}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          {forecastOpen && loc.forecast.length === 0 ? (
            <p className="small muted">{t('weather.noForecast', language)}</p>
          ) : null}

          <a
            className={styles.weatherHeroCredit}
            href={w.attribution.url}
            target="_blank"
            rel="noreferrer"
          >
            {w.attribution.text}
          </a>
        </>
      )}
    </section>
  );
}

/** A plain outline glyph from the provider's condition string; never parsed as an icon code. */
function WeatherGlyph({ conditions }: { conditions: string }) {
  const c = conditions.toLowerCase();
  const rain = c.includes('rain') || c.includes('drizzle') || c.includes('storm');
  const clear = c.includes('clear') || c.includes('sun');
  return (
    <svg
      viewBox="0 0 64 48"
      width="72"
      height="54"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
    >
      {clear ? (
        <>
          <circle cx="32" cy="24" r="10" />
          <path d="M32 4v6M32 38v6M12 24h6M46 24h6M18 10l4 4M42 34l4 4M18 38l4-4M42 14l4-4" />
        </>
      ) : (
        <>
          <path d="M18 36h28a9 9 0 0 0 1-18 12 12 0 0 0-23-3 8 8 0 0 0-6 21z" />
          {rain ? <path d="M22 40l-2 6M32 40l-2 6M42 40l-2 6" /> : null}
        </>
      )}
    </svg>
  );
}

function dayName(isoDate: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar' : 'en', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function timeOf(iso: string, language: Language): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar' : 'en', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Juba',
  }).format(d);
}
