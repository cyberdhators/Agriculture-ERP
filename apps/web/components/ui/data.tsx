'use client';

import type { ReactNode } from 'react';

import { Button, Field, Input, Skeleton } from './index';
import { IconChevronLeft, IconChevronRight, IconInfo } from './icons';
import styles from './data.module.css';

/**
 * DATA-DISPLAY PRIMITIVES, added to "The Register" rather than beside it.
 *
 * Everything here uses the kit's own tokens, the kit's Button and Field, and
 * the kit's near-square, rule-not-shadow structure. Nothing here introduces a
 * dependency: the chart is inline SVG-free HTML bars, the date range is two
 * native date inputs, the toast is a live region. That is the same decision
 * that keeps farm boundaries as inline SVG with no map library.
 *
 * TWO RULES ABOUT FIGURES, BOTH ENFORCED IN TYPES BELOW.
 *
 * 1. A figure the routes do not serve is never invented. `StatCard` takes
 *    `value: number | null`; null renders as "Not measured" with the reason,
 *    not as a zero. A zero and an unmeasured figure look identical on a
 *    dashboard and mean opposite things.
 * 2. Pagination is CURSOR-based, because the API is. There is no page count
 *    and no "jump to page 7": `GET /api/farmers` returns `{cursor, hasMore}`
 *    and nothing else can honestly be drawn from that.
 */

function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

/* ---- StatCard --------------------------------------------------------- */

export interface StatCardProps {
  label: string;
  /** Null means the routes do not serve this figure. It is never rendered as 0. */
  value: number | string | null;
  /** Shown under the value: what the figure counts, or the period it covers. */
  note?: ReactNode;
  /** Draws the eye — for a figure that represents work not being done. */
  attention?: boolean;
  /** Why the figure is missing. Required whenever `value` is null. */
  unmeasuredBecause?: string;
  footer?: ReactNode;
}

export function StatCard({
  label,
  value,
  note,
  attention = false,
  unmeasuredBecause,
  footer,
}: StatCardProps) {
  const missing = value === null;
  return (
    <div
      className={cx(
        styles.stat,
        attention && !missing && styles.statAttention,
        missing && styles.unmeasured,
      )}
    >
      <p className={styles.statLabel}>{label}</p>
      {missing ? (
        <>
          <span className={styles.unmeasuredTag}>
            <IconInfo size={13} /> Not measured
          </span>
          <p className={styles.statNote}>{unmeasuredBecause}</p>
        </>
      ) : (
        <>
          <p className={styles.statValue}>
            {typeof value === 'number' ? value.toLocaleString('en') : value}
          </p>
          {note ? <p className={styles.statNote}>{note}</p> : null}
        </>
      )}
      {footer ? <div className={styles.statFoot}>{footer}</div> : null}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className={styles.statGrid}>{children}</div>;
}

/* ---- DataTable -------------------------------------------------------- */

export interface Column<Row> {
  key: string;
  /** Plain text: the column heading, and the label each cell carries when the
   *  table stacks into cards on a narrow screen. Always a string so both uses
   *  stay readable. */
  header: string;
  /** Right-aligned and tabular. Use for every quantity. */
  numeric?: boolean;
  nowrap?: boolean;
  /** Marks this cell the row's header, for screen readers reading a row. */
  rowHeader?: boolean;
  /**
   * Dropped from the printed page. For columns that are controls rather than
   * record — a selection checkbox prints as an empty box that looks like a
   * form somebody is meant to fill in by hand.
   */
  printHidden?: boolean;
  /** Rendered in the heading cell INSTEAD of `header` — for a select-all
   *  control — while `header` remains the text those cells are labelled by. */
  headerNode?: ReactNode;
  render: (row: Row) => ReactNode;
}

export interface DataTableProps<Row> {
  /** Describes the table to a screen reader. Required: an unlabelled table is a maze. */
  caption: string;
  /** Shown above the table. Omit to keep the caption for assistive tech only. */
  captionVisible?: boolean;
  columns: ReadonlyArray<Column<Row>>;
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Rendered instead of an empty tbody. */
  empty?: ReactNode;
}

/**
 * An accessible table that becomes cards below 720px.
 *
 * Each cell carries `data-label`, which the stylesheet prints as the column
 * name once the table is stacked — so a narrow screen reads as a labelled
 * card instead of a table with its headings scrolled out of sight.
 */
export function DataTable<Row>({
  caption,
  captionVisible = false,
  columns,
  rows,
  rowKey,
  empty,
}: DataTableProps<Row>) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={captionVisible ? undefined : 'visually-hidden'}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx(
                  column.numeric && styles.num,
                  column.nowrap && styles.nowrap,
                  column.printHidden && 'no-print',
                )}
              >
                {column.headerNode ?? column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) =>
                column.rowHeader ? (
                  <th
                    key={column.key}
                    scope="row"
                    data-label={column.header}
                    className={cx(styles.rowHeader, column.nowrap && styles.nowrap)}
                  >
                    {column.render(row)}
                  </th>
                ) : (
                  <td
                    key={column.key}
                    data-label={column.header}
                    className={cx(
                      column.numeric && styles.num,
                      column.nowrap && styles.nowrap,
                      column.printHidden && 'no-print',
                    )}
                  >
                    {column.render(row)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---- FilterBar -------------------------------------------------------- */

export function FilterBar({
  children,
  actions,
  resultNote,
}: {
  children: ReactNode;
  actions?: ReactNode;
  resultNote?: ReactNode;
}) {
  return (
    <div className={styles.filterBar} role="search">
      {children}
      {resultNote ? <span className={styles.filterCount}>{resultNote}</span> : null}
      {actions ? <div className={styles.filterActions}>{actions}</div> : null}
    </div>
  );
}

export function FilterField({ children }: { children: ReactNode }) {
  return <div className={styles.filterGrow}>{children}</div>;
}

/* ---- DateRangePicker -------------------------------------------------- */

/**
 * Two native date inputs. The platform's own picker is keyboard-accessible,
 * localised by the browser and costs nothing to download — three things a
 * library would have to earn.
 */
export function DateRangePicker({
  fromLabel = 'From',
  toLabel = 'To',
  from,
  to,
  onChange,
  max,
}: {
  fromLabel?: string;
  toLabel?: string;
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
  max?: string;
}) {
  return (
    <div className={styles.range}>
      <Field label={fromLabel}>
        {(ids) => (
          <Input
            {...ids}
            type="date"
            value={from}
            max={to || max}
            onChange={(event) => onChange({ from: event.target.value, to })}
          />
        )}
      </Field>
      <span className={styles.rangeTo} aria-hidden>
        –
      </span>
      <Field label={toLabel}>
        {(ids) => (
          <Input
            {...ids}
            type="date"
            value={to}
            min={from || undefined}
            max={max}
            onChange={(event) => onChange({ from, to: event.target.value })}
          />
        )}
      </Field>
    </div>
  );
}

/* ---- Pagination ------------------------------------------------------- */

/**
 * Cursor pagination, because that is what the API serves.
 *
 * `GET /api/farmers` answers `{ cursor, hasMore }` — there is no total and no
 * page number, so this offers "more" and "back", and says how many rows are
 * on the page rather than inventing "page 3 of 19".
 */
export function Pagination({
  shown,
  hasMore,
  onNext,
  onPrevious,
  canGoBack = false,
  busy = false,
}: {
  shown: number;
  hasMore: boolean;
  onNext: () => void;
  onPrevious?: () => void;
  canGoBack?: boolean;
  busy?: boolean;
}) {
  return (
    <div className={styles.pager}>
      <span className={styles.pagerNote} aria-live="polite">
        {shown === 0 ? 'No rows' : `${shown.toLocaleString('en')} shown`}
        {hasMore ? ' · more available' : ''}
      </span>
      {onPrevious ? (
        <Button variant="secondary" size="small" onClick={onPrevious} disabled={!canGoBack || busy}>
          <IconChevronLeft size={16} /> Previous
        </Button>
      ) : null}
      <Button variant="secondary" size="small" onClick={onNext} disabled={!hasMore || busy}>
        Next <IconChevronRight size={16} />
      </Button>
    </div>
  );
}

/* ---- ChartCard -------------------------------------------------------- */

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Renders in the pending amber instead of the brand green. */
  pending?: boolean;
}

/**
 * A horizontal bar chart in plain HTML, with the figures beside the bars.
 *
 * `role="img"` with a full text label on each row is why this needs no table
 * fallback: the numbers are read out, not inferred from a picture. A chart
 * whose only content is a shape is a chart a screen reader cannot report.
 */
export function ChartCard({
  title,
  note,
  data,
  max,
  empty = 'Nothing to chart in this scope.',
  action,
  children,
}: {
  title: string;
  note?: ReactNode;
  /** Omit when the card hosts `children` instead of bars. */
  data?: readonly BarDatum[];
  /** Defaults to the largest value present. */
  max?: number;
  empty?: ReactNode;
  action?: ReactNode;
  /**
   * Anything that is not a bar chart — a donut, an unavailable state — in the
   * same frame, so every chart on a page shares one title, note and border
   * rather than each inventing its own.
   */
  children?: ReactNode;
}) {
  const bars = data ?? [];
  const ceiling = max ?? bars.reduce((high, d) => Math.max(high, d.value), 0);
  return (
    <section className={styles.chart}>
      <div className={styles.chartHead}>
        <div>
          <h2 className={styles.chartTitle}>{title}</h2>
          {note ? <p className={styles.chartNote}>{note}</p> : null}
        </div>
        {action}
      </div>
      {children ?? null}
      {children ? null : bars.length === 0 ? (
        <p className={styles.chartNote}>{empty}</p>
      ) : (
        <div className={styles.bars}>
          {bars.map((d) => {
            const pct = ceiling === 0 ? 0 : Math.round((d.value / ceiling) * 100);
            return (
              <div key={d.key} className={styles.barRow}>
                <span className={styles.barName} title={d.label} dir="auto">
                  {d.label}
                </span>
                <span
                  className={styles.barTrack}
                  role="img"
                  aria-label={`${d.label}: ${d.value.toLocaleString('en')}`}
                >
                  <span
                    className={cx(styles.barFill, d.pending && styles.barFillPending)}
                    style={{ inlineSize: `${pct}%` }}
                  />
                </span>
                <span className={styles.barValue}>{d.value.toLocaleString('en')}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---- Loading ---------------------------------------------------------- */

export function LoadingState({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={index === 0 ? 22 : 16} width={index === 0 ? '40%' : '100%'} />
      ))}
    </div>
  );
}

/* ---- DonutChart ------------------------------------------------------- */

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  percent: number;
  /** stroke-dasharray for a circle of circumference 100. */
  dash: string;
  offset: number;
  /** A CSS custom property or colour token. Colour is never the only signal. */
  color: string;
}

/**
 * A ring drawn with four stroked arcs on one circle.
 *
 * The circle's circumference is set to exactly 100 units, so a slice's arc
 * length IS its percentage and no trigonometry is involved. The ring itself is
 * `aria-hidden`; the figure is described by `summaryText` and repeated in the
 * legend as label, count and percent — so the chart is readable with colour
 * vision, without it, and with no vision at all.
 */
export function DonutChart({
  slices,
  summaryText,
  centreValue,
  centreLabel,
}: {
  slices: readonly DonutSlice[];
  summaryText: string;
  centreValue?: string;
  centreLabel?: string;
}) {
  // r chosen so 2*pi*r === 100: the arc length is the percentage.
  const r = 100 / (2 * Math.PI);
  return (
    <div className={styles.donutWrap}>
      <div style={{ position: 'relative', flex: '0 0 auto' }}>
        <svg className={styles.donutFigure} viewBox="0 0 40 40" aria-hidden focusable="false">
          <circle className={styles.donutTrack} cx="20" cy="20" r={r} fill="none" strokeWidth="6" />
          {slices.map((slice) => (
            <circle
              key={slice.key}
              cx="20"
              cy="20"
              r={r}
              fill="none"
              strokeWidth="6"
              stroke={slice.color}
              strokeDasharray={slice.dash}
              strokeDashoffset={slice.offset}
            />
          ))}
        </svg>
        {centreValue ? (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
                fontSize: 22,
                color: 'var(--ink)',
              }}
            >
              {centreValue}
            </span>
            {centreLabel ? (
              <span style={{ fontSize: 'var(--text-label)', color: 'var(--muted)' }}>
                {centreLabel}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      <p className="visually-hidden">{summaryText}</p>

      <ul className={styles.donutLegend}>
        {slices.map((slice) => (
          <li key={slice.key} className={styles.legendRow}>
            <span className={styles.legendSwatch} style={{ background: slice.color }} aria-hidden />
            <span className={styles.legendLabel}>{slice.label}</span>
            <span className={styles.legendValue}>{slice.value.toLocaleString('en')}</span>
            <span className={styles.legendPercent}>{slice.percent}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---- The three states that are not each other ------------------------- */

/**
 * NOT MEASURED — the system cannot currently produce this figure.
 *
 * Distinct from an empty result, which means the system looked and found
 * nothing, and from an error, which means it could not look. Conflating the
 * three is how a dashboard comes to report zero farmers in a state that has
 * simply never been counted.
 */
export function UnavailableState({
  title = 'Not measured',
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.unavailable}>
      <span aria-hidden style={{ color: 'var(--muted)', flex: '0 0 auto' }}>
        <IconInfo size={18} />
      </span>
      <div>
        <p className={styles.unavailableTitle}>{title}</p>
        <p className={styles.unavailableBody}>{children}</p>
      </div>
    </div>
  );
}

/** A section's skeleton, shaped like the cards it replaces so nothing jumps. */
export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={styles.skelGrid} role="status" aria-live="polite">
      <span className="visually-hidden">Loading</span>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.skelCard}>
          <Skeleton width="55%" height={11} />
          <Skeleton width="40%" height={28} />
          <Skeleton width="80%" height={11} />
        </div>
      ))}
    </div>
  );
}
