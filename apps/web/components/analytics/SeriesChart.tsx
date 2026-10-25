'use client';

import { useId } from 'react';

import {
  ANALYTICS_BUCKET_LABELS,
  type AnalyticsBucket,
  type AnalyticsSeriesValue,
  type SeriesDefinition,
  UNAVAILABLE_TEXT,
} from '@agri-erp/shared';

import styles from './analytics.module.css';

/**
 * AN OVER-TIME FIGURE (2026-10-28): registrations, new and returning active
 * accounts, listings against buying requests. Inline SVG, no library, like
 * the breakdown bars beside it: a line for movement, clustered columns for
 * counts per period. Two series at most, told apart by colour AND by the
 * legend and the table under the chart, so nothing rests on colour alone.
 * The SVG is an image with a title and a description; the numbers are in a
 * table one click away, and on paper.
 */

const W = 560;
const H = 220;
const LEFT = 40;
const RIGHT = 12;
const TOP = 12;
const BOTTOM = 34;
const PLOT_W = W - LEFT - RIGHT;
const PLOT_H = H - TOP - BOTTOM;

/** Series colours, in order: brand green, then harvest gold (the second accent). */
const SERIES_CLASS = [styles.seriesA, styles.seriesB] as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A period start in words: "12 Oct" for a day or a week, "Oct 2026" for a month. */
export function periodLabel(period: string, bucket: AnalyticsBucket): string {
  const month = MONTHS[Number(period.slice(5, 7)) - 1] ?? period.slice(5, 7);
  return bucket === 'month'
    ? `${month} ${period.slice(0, 4)}`
    : `${Number(period.slice(8, 10))} ${month}`;
}

/** A round top for the value axis: 1, 2, 5 times a power of ten, never below 1. */
export function niceMax(max: number): number {
  if (max <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) {
    if (step * power >= max) return step * power;
  }
  return 10 * power;
}

export function SeriesChart({
  def,
  bucket,
  value,
}: {
  def: SeriesDefinition;
  bucket: AnalyticsBucket;
  value: AnalyticsSeriesValue | undefined;
}) {
  const id = useId();
  const keys = Object.keys(def.keys);

  if (!value || value.lines === null) {
    return (
      <figure className={`${styles.chart} print-flat`}>
        <figcaption className={styles.chartTitle}>{def.label}</figcaption>
        <p className={styles.chartNote}>
          Not measured.{' '}
          {value?.unavailable ? UNAVAILABLE_TEXT[value.unavailable] : 'The figure was not served.'}
        </p>
      </figure>
    );
  }

  const lines = keys.map((k) => value.lines!.find((l) => l.key === k)?.points ?? []);
  const periods = value.periods;
  const n = periods.length;
  const top = niceMax(Math.max(0, ...lines.flat()));
  const y = (v: number) => TOP + PLOT_H - (v / top) * PLOT_H;
  const slot = PLOT_W / Math.max(1, n);
  const xMid = (i: number) => LEFT + slot * i + slot / 2;
  // About six labels on the time axis, whatever the number of periods.
  const every = Math.max(1, Math.ceil(n / 6));
  const described = periods
    .map(
      (p, i) =>
        `${periodLabel(p, bucket)}: ${keys
          .map((k, s) => `${def.keys[k]} ${(lines[s]?.[i] ?? 0).toLocaleString('en')}`)
          .join(', ')}`,
    )
    .join('; ');
  const totals = keys.map((_k, s) => (lines[s] ?? []).reduce((a, b) => a + b, 0));

  return (
    <figure className={`${styles.chart} print-flat`}>
      <figcaption className={styles.chartTitle}>
        {def.label} <span>by {ANALYTICS_BUCKET_LABELS[bucket].toLowerCase()}</span>
      </figcaption>
      <ul className={styles.seriesLegend}>
        {keys.map((k, s) => (
          <li key={k}>
            <span className={`${styles.swatch} ${SERIES_CLASS[s % 2]}`} aria-hidden="true" />
            {def.keys[k]} <b>{(totals[s] ?? 0).toLocaleString('en')}</b>
          </li>
        ))}
      </ul>
      <svg
        role="img"
        aria-labelledby={`${id}-t ${id}-d`}
        viewBox={`0 0 ${W} ${H}`}
        className={styles.svg}
      >
        <title id={`${id}-t`}>{def.label}</title>
        <desc id={`${id}-d`}>{described}</desc>
        {[0, top / 2, top].map((tick) => (
          <g key={tick}>
            <line x1={LEFT} x2={W - RIGHT} y1={y(tick)} y2={y(tick)} className={styles.grid} />
            <text x={LEFT - 6} y={y(tick) + 4} className={styles.axisLabel} textAnchor="end">
              {Number.isInteger(tick) ? tick.toLocaleString('en') : ''}
            </text>
          </g>
        ))}
        {periods.map((p, i) =>
          i % every === 0 ? (
            <text
              key={p}
              x={xMid(i)}
              y={H - BOTTOM + 16}
              className={styles.axisLabel}
              textAnchor="middle"
            >
              {periodLabel(p, bucket)}
            </text>
          ) : null,
        )}
        {def.chart === 'column'
          ? lines.map((points, s) => {
              const barW = Math.max(1, (slot * 0.7) / keys.length);
              return points.map((v, i) => {
                const x = LEFT + slot * i + slot * 0.15 + barW * s;
                return v > 0 ? (
                  <rect
                    key={`${s}-${periods[i]}`}
                    x={x}
                    y={y(v)}
                    width={barW}
                    height={TOP + PLOT_H - y(v)}
                    className={SERIES_CLASS[s % 2]}
                  />
                ) : null;
              });
            })
          : lines.map((points, s) => (
              <g key={keys[s]}>
                <polyline
                  points={points.map((v, i) => `${xMid(i)},${y(v)}`).join(' ')}
                  className={`${styles.seriesLine} ${SERIES_CLASS[s % 2]}`}
                />
                {n <= 40
                  ? points.map((v, i) => (
                      <circle
                        key={periods[i]}
                        cx={xMid(i)}
                        cy={y(v)}
                        r={3}
                        className={SERIES_CLASS[s % 2]}
                      />
                    ))
                  : null}
              </g>
            ))}
      </svg>
      {def.separateMeasures ? (
        <p className={styles.chartNote}>Two different measures: never add them together.</p>
      ) : null}
      <details className={`${styles.definition} no-print`}>
        <summary>Show the numbers and what they count</summary>
        <p>{def.definition}</p>
        <table className={styles.seriesTable}>
          <thead>
            <tr>
              <th scope="col">{ANALYTICS_BUCKET_LABELS[bucket]}</th>
              {keys.map((k) => (
                <th key={k} scope="col">
                  {def.keys[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p, i) => (
              <tr key={p}>
                <th scope="row">{p}</th>
                {keys.map((k, s) => (
                  <td key={k}>{(lines[s]?.[i] ?? 0).toLocaleString('en')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
