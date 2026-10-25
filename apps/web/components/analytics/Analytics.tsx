'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import {
  ACTIVITIES,
  ANALYTICS_ACTOR_LABELS,
  ANALYTICS_METRICS,
  ANALYTICS_SERIES,
  type AnalyticsFilter,
  type AnalyticsMetricValue,
  type AnalyticsSummary,
  METRIC_GROUPS,
  METRIC_GROUP_LABELS,
  type MetricDefinition,
  type MetricUnit,
  UNAVAILABLE_TEXT,
  analyticsFilterSchema,
  LISTING_CATEGORIES,
  jubaToday,
} from '@agri-erp/shared';

import { formatJubaTime } from '@/lib/admin/access-view';
import {
  AnalyticsApiError,
  downloadAnalyticsWorkbook,
  getAnalyticsSummary,
} from '@/lib/analytics/api';
import { breakdownLabel, narrowingLabels } from '@/lib/analytics/workbook';
import { CATEGORY_LABELS } from '@/lib/buyer/labels';
import { useLocationNames } from '@/lib/portal/locations';
import { usePreview } from '@/lib/preview';
import { useQueryState } from '@/lib/query-state';

import { Button, Card, Field, Notice, PageHeader, Select } from '../ui';
import { DateRangePicker, LoadingState, StatCard, StatGrid } from '../ui/data';
import styles from './analytics.module.css';
import { SeriesChart } from './SeriesChart';

/**
 * MARKETPLACE AND ACCOUNT ANALYTICS (2026-10-22). CORWADO's specification,
 * "Measures and exports".
 *
 * Every figure is served by GET /api/analytics/summary and DEFINED in
 * packages/shared/src/analytics.ts: each card can show what it counts, over
 * what, from where and in which window, and the printed page carries all of
 * them. Buying requests, messages, orders and completed trades are separate
 * cards and are never added together. A figure the server cannot produce is
 * "Not measured" with its reason, never a zero.
 *
 * Excel: POST /api/analytics/export, which records the export before the file
 * leaves (administrators and supervisors). PDF: the browser's own print, with
 * a print layout carrying title, window, filters, legend, generation time
 * (Juba) and limitations.
 */

const UNIT_LABEL: Readonly<Record<MetricUnit, string>> = {
  people: 'people',
  accounts: 'accounts',
  profiles: 'profiles',
  records: 'records',
  events: 'events',
  phones: 'phone numbers',
  days: 'days (median)',
  stars: 'stars out of 5 (average)',
};

/** Figures shown as a share of another, with the denominator their definition names. */
const SHARE_OF: Readonly<Record<string, string>> = {
  'onboarding.phones_confirmed': 'onboarding.phones_started',
  'access.returning': 'access.active',
};

interface Draft {
  from: string;
  to: string;
  state: string;
  /** 2026-10-28: '' is "all". */
  commodity: string;
  actor: string;
}

const EMPTY_DRAFT: Draft = { from: '', to: '', state: '', commodity: '', actor: '' };

export function Analytics() {
  const { role, hydrated } = usePreview();
  const { get, set } = useQueryState();
  const names = useLocationNames(hydrated);

  /** The applied filters live in the URL, so a view can be bookmarked and shared. */
  const applied = useMemo<AnalyticsFilter>(() => {
    const from = get('from');
    const to = get('to');
    const state = get('state');
    const commodity = get('commodity');
    const actor = get('actor');
    return {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(state ? { state_id: state } : {}),
      // Unknown values from a hand-edited address are sent as they are and
      // refused by the shared schema with its own sentence.
      ...(commodity ? { commodity: commodity as AnalyticsFilter['commodity'] } : {}),
      ...(actor ? { actor_type: actor as AnalyticsFilter['actor_type'] } : {}),
    };
  }, [get]);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status: number; message: string } | undefined>();
  const [downloading, setDownloading] = useState(false);
  const [exportNote, setExportNote] = useState<{ ok: boolean; text: string } | undefined>();

  const canExport = hydrated && (role === 'admin' || role === 'supervisor');

  useEffect(() => {
    setDraft({
      from: applied.from ?? '',
      to: applied.to ?? '',
      state: applied.state_id ?? '',
      commodity: applied.commodity ?? '',
      actor: applied.actor_type ?? '',
    });
  }, [applied]);

  const load = useCallback(async (filter: AnalyticsFilter) => {
    setLoading(true);
    setError(undefined);
    try {
      setSummary(await getAnalyticsSummary(filter));
    } catch (e) {
      setSummary(null);
      setError({
        status: e instanceof AnalyticsApiError ? e.status : 0,
        message: e instanceof Error ? e.message : 'The figures could not be loaded.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(applied);
  }, [applied, load]);

  function apply() {
    const candidate = {
      ...(draft.from ? { from: draft.from } : {}),
      ...(draft.to ? { to: draft.to } : {}),
      ...(draft.state ? { state_id: draft.state } : {}),
      ...(draft.commodity ? { commodity: draft.commodity } : {}),
      ...(draft.actor ? { actor_type: draft.actor } : {}),
    };
    const parsed = analyticsFilterSchema.safeParse(candidate);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'from');
        errors[key] ??= issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    set({
      from: draft.from || null,
      to: draft.to || null,
      state: draft.state || null,
      commodity: draft.commodity || null,
      actor: draft.actor || null,
    });
  }

  function reset() {
    setFieldErrors({});
    set({ from: null, to: null, state: null, commodity: null, actor: null });
  }

  async function download() {
    setDownloading(true);
    setExportNote(undefined);
    try {
      await downloadAnalyticsWorkbook(applied);
      setExportNote({
        ok: true,
        text: 'The Excel file was downloaded, and the export was recorded.',
      });
    } catch (e) {
      setExportNote({
        ok: false,
        text: e instanceof Error ? e.message : 'The Excel file could not be produced.',
      });
    } finally {
      setDownloading(false);
    }
  }

  const stateName = (id: string) => names.state(id) ?? id;
  const narrowing = narrowingLabels({
    commodity: summary?.commodity ?? null,
    actor_type: summary?.actor_type ?? null,
  });
  const filterText = [
    applied.state_id ? `State: ${stateName(applied.state_id)}` : 'All states in scope',
    narrowing.commodity,
    narrowing.actorType,
  ].join(' · ');
  const scopeText = summary?.scope_states
    ? summary.scope_states.map(stateName).join(', ')
    : 'National';
  const values = useMemo(() => new Map((summary?.metrics ?? []).map((m) => [m.id, m])), [summary]);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Analytics and exports"
        title="Marketplace analytics"
        subtitle="Accounts, participation and marketplace activity in a window of Juba days. Each figure is counted on its own and says what it counts."
        actions={
          <>
            {canExport ? (
              <Button variant="primary" onClick={download} disabled={downloading || !summary}>
                {downloading ? 'Preparing…' : 'Download Excel'}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => window.print()} disabled={!summary}>
              Print / Save as PDF
            </Button>
          </>
        }
      />

      {/* On paper only: what a printed sheet needs to be checked a week later. */}
      {summary ? (
        <div className="print-only">
          <p className={styles.printTitle}>AgriOne marketplace and account analytics</p>
          <p>
            Window: {summary.window.from} to {summary.window.to} ({summary.window.days} days,
            Africa/Juba). Data cut-off: end of {summary.window.to}.
          </p>
          <p>
            Filters: {filterText}. Scope: {scopeText}.
          </p>
          <p>Generated: {formatJubaTime(summary.generated_at)} (Africa/Juba).</p>
        </div>
      ) : null}

      <Card padded className="no-print">
        <div className={styles.filters}>
          <DateRangePicker
            from={draft.from}
            to={draft.to}
            max={jubaToday()}
            onChange={(next) => setDraft((d) => ({ ...d, ...next }))}
          />
          <Field label="State" optional error={fieldErrors.state_id}>
            {(ids) => (
              <Select
                {...ids}
                value={draft.state}
                onChange={(e) => setDraft((d) => ({ ...d, state: e.target.value }))}
              >
                <option value="">All states in scope</option>
                {names.states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Commodity" optional error={fieldErrors.commodity}>
            {(ids) => (
              <Select
                {...ids}
                value={draft.commodity}
                onChange={(e) => setDraft((d) => ({ ...d, commodity: e.target.value }))}
              >
                <option value="">All commodities</option>
                {LISTING_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Actor type" optional error={fieldErrors.actor_type}>
            {(ids) => (
              <Select
                {...ids}
                value={draft.actor}
                onChange={(e) => setDraft((d) => ({ ...d, actor: e.target.value }))}
              >
                <option value="">All actor types</option>
                {ACTIVITIES.map((a) => (
                  <option key={a} value={a}>
                    {ANALYTICS_ACTOR_LABELS[a]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className={styles.apply}>
            <Button variant="secondary" onClick={apply}>
              Apply
            </Button>
            <Button variant="ghost" onClick={reset}>
              Last 30 days
            </Button>
          </div>
        </div>
        {fieldErrors.from || fieldErrors.to ? (
          <p className={styles.fieldError} role="alert">
            {fieldErrors.from ?? fieldErrors.to}
          </p>
        ) : null}
      </Card>

      {exportNote ? (
        <Notice kind={exportNote.ok ? 'success' : 'error'} className="no-print">
          {exportNote.text}
        </Notice>
      ) : null}

      {loading ? <LoadingState rows={4} label="Loading the figures" /> : null}

      {!loading && error ? (
        <Notice
          kind="error"
          title={
            error.status === 403
              ? 'You cannot view these figures'
              : 'The figures could not be loaded'
          }
        >
          {error.status === 403
            ? 'Analytics needs the "View data and reports" permission for your state. An administrator can give it through the Analyst preset.'
            : error.message}
        </Notice>
      ) : null}

      {!loading && summary ? (
        <>
          <p className={`${styles.windowLine} no-print`}>
            <b>
              {summary.window.from} to {summary.window.to}
            </b>
            <span>{summary.window.days} days, Juba time</span>
            <span>{filterText}</span>
            <span>Scope: {scopeText}</span>
            <span>Generated {formatJubaTime(summary.generated_at)}</span>
          </p>

          {summary.commodity || summary.actor_type ? (
            <Notice kind="info" className="no-print">
              The commodity and actor-type filters narrow only the figures that can be narrowed;
              every other figure says &ldquo;Not measured&rdquo; under them rather than show an
              unfiltered number.
            </Notice>
          ) : null}

          <section className={styles.group} aria-labelledby="group-over-time">
            <h2 id="group-over-time" className={styles.groupTitle}>
              Over time
            </h2>
            <div className={styles.charts}>
              {ANALYTICS_SERIES.map((def) => (
                <SeriesChart
                  key={def.id}
                  def={def}
                  bucket={summary.bucket}
                  value={summary.series.find((v) => v.id === def.id)}
                />
              ))}
            </div>
          </section>

          {METRIC_GROUPS.map((group) => {
            const defs = ANALYTICS_METRICS.filter((m) => m.group === group);
            const charted = defs.filter((d) => {
              const v = values.get(d.id);
              return d.breakdown && v?.breakdown && v.breakdown.length > 0;
            });
            return (
              <section key={group} className={styles.group} aria-labelledby={`group-${group}`}>
                <h2 id={`group-${group}`} className={styles.groupTitle}>
                  {METRIC_GROUP_LABELS[group]}
                </h2>
                <StatGrid>
                  {defs.map((def) => (
                    <MetricCard key={def.id} def={def} value={values.get(def.id)} values={values} />
                  ))}
                </StatGrid>
                {charted.length > 0 ? (
                  <div className={styles.charts}>
                    {charted.map((def) => (
                      <BarChart key={def.id} def={def} value={values.get(def.id)!} />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}

          <section className={styles.group} aria-labelledby="limitations">
            <h2 id="limitations" className={styles.groupTitle}>
              Limitations
            </h2>
            <ul className={styles.limits}>
              {summary.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>

          {/* The legend, on paper: every figure's definition in one table. */}
          <section className="print-only print-break-before">
            <p className={styles.printTitle}>Definitions</p>
            <table className={styles.legend}>
              <thead>
                <tr>
                  <th scope="col">Figure</th>
                  <th scope="col">Counts</th>
                  <th scope="col">Denominator</th>
                  <th scope="col">Source</th>
                  <th scope="col">Window</th>
                  <th scope="col">State filter</th>
                </tr>
              </thead>
              <tbody>
                {ANALYTICS_METRICS.map((def) => (
                  <tr key={def.id}>
                    <th scope="row">{def.label}</th>
                    <td>{def.definition}</td>
                    <td>{def.denominator}</td>
                    <td>{def.source}</td>
                    <td>{def.window}</td>
                    <td>{def.stateRule ?? 'National figure only.'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </div>
  );
}

function MetricCard({
  def,
  value,
  values,
}: {
  def: MetricDefinition;
  value: AnalyticsMetricValue | undefined;
  values: ReadonlyMap<string, AnalyticsMetricValue>;
}) {
  const v = value?.value ?? null;
  const shareOf = SHARE_OF[def.id];
  const base = shareOf ? values.get(shareOf)?.value : null;
  const share =
    v !== null && typeof base === 'number' && base > 0 ? Math.round((v / base) * 100) : null;
  return (
    <StatCard
      label={def.label}
      value={v}
      unmeasuredBecause={value?.unavailable ? UNAVAILABLE_TEXT[value.unavailable] : 'Not served.'}
      note={
        <>
          {UNIT_LABEL[def.unit]}
          {share !== null ? ` · ${share}% of the denominator` : ''}
        </>
      }
      footer={
        <details className={`${styles.definition} no-print`}>
          <summary>What this counts</summary>
          <p>{def.definition}</p>
          <dl>
            <dt>Denominator</dt>
            <dd>{def.denominator}</dd>
            <dt>Source</dt>
            <dd>{def.source}</dd>
            <dt>Window</dt>
            <dd>{def.window}</dd>
            <dt>State filter</dt>
            <dd>{def.stateRule ?? 'Not located: a national figure only.'}</dd>
          </dl>
        </details>
      }
    />
  );
}

const ROW = 30;
const LABEL_W = 210;
const BAR_W = 300;
const WIDTH = LABEL_W + BAR_W + 70;

/**
 * A horizontal bar chart in inline SVG, no library. The SVG is an image with
 * a title and a description that reads every bar out, so a screen reader
 * hears the figures rather than a picture; the numbers are also printed
 * beside each bar.
 */
function BarChart({ def, value }: { def: MetricDefinition; value: AnalyticsMetricValue }) {
  const id = useId();
  const rows = (value.breakdown ?? []).map((b) => ({
    key: b.key,
    label: breakdownLabel(def, b),
    value: b.value,
  }));
  const max = Math.max(1, ...rows.map((r) => r.value));
  const height = rows.length * ROW + 8;
  const described = rows.map((r) => `${r.label}: ${r.value.toLocaleString('en')}`).join('; ');
  const short = (s: string) => (s.length > 30 ? `${s.slice(0, 29)}…` : s);
  return (
    <figure className={`${styles.chart} print-flat`}>
      <figcaption className={styles.chartTitle}>
        {def.label} <span>by {def.breakdown?.label.toLowerCase()}</span>
      </figcaption>
      <svg
        role="img"
        aria-labelledby={`${id}-t ${id}-d`}
        viewBox={`0 0 ${WIDTH} ${height}`}
        className={styles.svg}
      >
        <title
          id={`${id}-t`}
        >{`${def.label} by ${def.breakdown?.label.toLowerCase() ?? ''}`}</title>
        <desc id={`${id}-d`}>{described}</desc>
        {rows.map((r, i) => {
          const y = i * ROW + 4;
          const w = Math.max(r.value > 0 ? 2 : 0, Math.round((r.value / max) * BAR_W));
          return (
            <g key={r.key}>
              <text x={0} y={y + ROW / 2 + 4} className={styles.svgLabel}>
                {short(r.label)}
              </text>
              <rect x={LABEL_W} y={y + 5} width={w} height={ROW - 12} className={styles.svgBar} />
              <text x={LABEL_W + w + 6} y={y + ROW / 2 + 4} className={styles.svgValue}>
                {r.value.toLocaleString('en')}
              </text>
            </g>
          );
        })}
      </svg>
      {def.breakdown?.overlapping ? (
        <p className={styles.chartNote}>
          The bars overlap: one account can be in several, so they do not add up to the total (
          {value.value?.toLocaleString('en') ?? '—'}).
        </p>
      ) : null}
    </figure>
  );
}
