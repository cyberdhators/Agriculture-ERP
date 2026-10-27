'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ANALYTICS_BUCKET_LABELS,
  type AnalyticsSeriesValue,
  LISTING_CATEGORIES,
  MATCH_ALERT_METRICS,
  MATCH_ALERT_SOURCES,
  MATCH_ALERT_SOURCE_LABELS,
  type MatchAlertReport,
  type MatchAlertReportFilter,
  type SeriesDefinition,
  jubaToday,
  matchAlertReportFilterSchema,
} from '@agri-erp/shared';

import { formatJubaTime } from '@/lib/admin/access-view';
import {
  AnalyticsApiError,
  downloadMatchAlertWorkbook,
  getMatchAlertReport,
} from '@/lib/analytics/api';
import { matchAlertFilterLabels } from '@/lib/analytics/match-alert-workbook';
import { CATEGORY_LABELS } from '@/lib/buyer/labels';
import { useLocationNames } from '@/lib/portal/locations';
import { usePreview } from '@/lib/preview';
import { useQueryState } from '@/lib/query-state';

import { Button, Card, Field, Input, Notice, PageHeader, Select } from '../ui';
import { DateRangePicker, LoadingState, StatCard, StatGrid } from '../ui/data';
import styles from './analytics.module.css';
import { SeriesChart, periodLabel } from './SeriesChart';

/**
 * MATCH-ALERT RESULTS (2026-11-03, owner-approved). Analytics and Exports.
 *
 * What the match alerts led to, for a window and filters: alerts sent (in
 * the app, by SMS), opened, conversations between the alerted person and
 * the poster within 7 days, completed deals between them within 30 days,
 * the conversion rates, and a trend. Every figure says what it counts, over
 * what and from where (MATCH_ALERT_METRICS); the print carries them all.
 * Served by GET /api/analytics/match-alerts; Excel by its export, recorded
 * before the file leaves. Counts only.
 */

interface Draft {
  from: string;
  to: string;
  state: string;
  commodity: string;
  product: string;
  source: string;
}

const EMPTY: Draft = { from: '', to: '', state: '', commodity: '', product: '', source: '' };

const TREND: SeriesDefinition = {
  id: 'series.match_alerts',
  label: 'Alerts sent and conversations started',
  unit: 'events',
  chart: 'line',
  definition:
    'Alerts sent per period, and how many of those alerts led to a conversation within 7 days.',
  denominator: 'None: counts.',
  source: 'marketing_notice and conversation',
  window: 'Counted per period, by the day the alert was sent.',
  stateRule: "The post's state.",
  keys: { sent: 'Alerts sent', conversations: 'Conversations within 7 days' },
  separateMeasures: true,
};

const pct = (v: number | null | undefined) => (v === null || v === undefined ? null : `${v}%`);

export function MatchAlertResults() {
  const { role, hydrated } = usePreview();
  const { get, set } = useQueryState();
  const names = useLocationNames(hydrated);

  const applied = useMemo<MatchAlertReportFilter>(() => {
    const out: Record<string, string> = {};
    for (const [key, param] of [
      ['from', 'from'],
      ['to', 'to'],
      ['state_id', 'state'],
      ['commodity', 'commodity'],
      ['product', 'product'],
      ['source', 'source'],
    ] as const) {
      const v = get(param);
      if (v) out[key] = v;
    }
    return out as MatchAlertReportFilter;
  }, [get]);

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [report, setReport] = useState<MatchAlertReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status: number; message: string } | undefined>();
  const [downloading, setDownloading] = useState(false);
  const [exportNote, setExportNote] = useState<{ ok: boolean; text: string } | undefined>();

  // The same rule as the export route: admin, supervisor and read_only, with
  // reports.view (held by anyone the report loaded for; the button waits for it).
  const canExport = hydrated && (role === 'admin' || role === 'supervisor' || role === 'read_only');

  useEffect(() => {
    setDraft({
      from: applied.from ?? '',
      to: applied.to ?? '',
      state: applied.state_id ?? '',
      commodity: applied.commodity ?? '',
      product: applied.product ?? '',
      source: applied.source ?? '',
    });
  }, [applied]);

  const load = useCallback(async (filter: MatchAlertReportFilter) => {
    setLoading(true);
    setError(undefined);
    try {
      setReport(await getMatchAlertReport(filter));
    } catch (e) {
      setReport(null);
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
    const candidate: Record<string, string> = {};
    if (draft.from) candidate.from = draft.from;
    if (draft.to) candidate.to = draft.to;
    if (draft.state) candidate.state_id = draft.state;
    if (draft.commodity) candidate.commodity = draft.commodity;
    if (draft.product.trim()) candidate.product = draft.product.trim();
    if (draft.source) candidate.source = draft.source;
    const parsed = matchAlertReportFilterSchema.safeParse(candidate);
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
      from: candidate.from ?? null,
      to: candidate.to ?? null,
      state: candidate.state_id ?? null,
      commodity: candidate.commodity ?? null,
      product: candidate.product ?? null,
      source: candidate.source ?? null,
    });
  }

  function reset() {
    setFieldErrors({});
    set({ from: null, to: null, state: null, commodity: null, product: null, source: null });
  }

  async function download() {
    setDownloading(true);
    setExportNote(undefined);
    try {
      await downloadMatchAlertWorkbook(applied);
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
  const filterText = report
    ? [
        applied.state_id ? `State: ${stateName(applied.state_id)}` : 'All states in scope',
        ...matchAlertFilterLabels(report),
      ].join(' · ')
    : '';
  const scopeText = report?.scope_states
    ? report.scope_states.map(stateName).join(', ')
    : 'National';
  const totals = report?.totals ?? null;
  const notMeasured = 'Match alerts are not in this database yet.';
  const trendValue: AnalyticsSeriesValue | undefined = report
    ? {
        id: TREND.id,
        periods: report.trend.periods,
        lines: [
          { key: 'sent', points: report.trend.sent },
          { key: 'conversations', points: report.trend.conversations },
        ],
      }
    : undefined;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Analytics and exports"
        title="Match-alert results"
        subtitle="What the match alerts led to: alerts sent and opened, conversations between the alerted person and the poster, and deals they completed. Counts only."
        actions={
          <>
            <Link href="/analytics" className="small no-print">
              Marketplace analytics
            </Link>
            {canExport ? (
              <Button variant="primary" onClick={download} disabled={downloading || !report}>
                {downloading ? 'Preparing…' : 'Download Excel'}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => window.print()} disabled={!report}>
              Print / Save as PDF
            </Button>
          </>
        }
      />

      {report ? (
        <div className="print-only">
          <p className={styles.printTitle}>AgriOne match-alert results</p>
          <p>
            Window: {report.window.from} to {report.window.to} ({report.window.days} days,
            Africa/Juba). Data cut-off: end of {report.window.to}.
          </p>
          <p>
            Filters: {filterText}. Scope: {scopeText}.
          </p>
          <p>Generated: {formatJubaTime(report.generated_at)} (Africa/Juba).</p>
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
          <Field label="Category" optional error={fieldErrors.commodity}>
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
          <Field label="Product" optional error={fieldErrors.product}>
            {(ids) => (
              <Input
                {...ids}
                value={draft.product}
                maxLength={80}
                onChange={(e) => setDraft((d) => ({ ...d, product: e.target.value }))}
              />
            )}
          </Field>
          <Field label="Alert source" optional error={fieldErrors.source}>
            {(ids) => (
              <Select
                {...ids}
                value={draft.source}
                onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}
              >
                <option value="">All alert sources</option>
                {MATCH_ALERT_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {MATCH_ALERT_SOURCE_LABELS[s]}
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

      {loading ? <LoadingState rows={3} label="Loading the figures" /> : null}

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
            ? 'This report needs the "View data and reports" permission for your state. An administrator can give it through the Analyst preset.'
            : error.message}
        </Notice>
      ) : null}

      {!loading && report ? (
        <>
          <p className={`${styles.windowLine} no-print`}>
            <b>
              {report.window.from} to {report.window.to}
            </b>
            <span>{report.window.days} days, Juba time</span>
            <span>{filterText}</span>
            <span>Scope: {scopeText}</span>
            <span>Generated {formatJubaTime(report.generated_at)}</span>
          </p>

          <section className={styles.group} aria-labelledby="ma-funnel">
            <h2 id="ma-funnel" className={styles.groupTitle}>
              From alert to deal
            </h2>
            <StatGrid>
              {MATCH_ALERT_METRICS.map((def) => {
                const value = totals
                  ? (totals[def.id as keyof typeof totals] as number | null)
                  : null;
                const share =
                  def.id === 'read'
                    ? pct(totals?.read_rate)
                    : def.id === 'conversations'
                      ? pct(totals?.conversation_rate)
                      : def.id === 'deals'
                        ? pct(totals?.deal_rate)
                        : null;
                return (
                  <StatCard
                    key={def.id}
                    label={def.label}
                    value={value}
                    unmeasuredBecause={notMeasured}
                    note={share ? `${share} of the denominator` : 'alerts'}
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
                        </dl>
                      </details>
                    }
                  />
                );
              })}
            </StatGrid>
          </section>

          <section className={styles.group} aria-labelledby="ma-sources">
            <h2 id="ma-sources" className={styles.groupTitle}>
              By alert source
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table className={styles.legend}>
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Sent</th>
                    <th scope="col">In the app</th>
                    <th scope="col">By SMS</th>
                    <th scope="col">Opened</th>
                    <th scope="col">Conversations</th>
                    <th scope="col">Deals</th>
                    <th scope="col">Opened %</th>
                    <th scope="col">Conversation %</th>
                    <th scope="col">Deal %</th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_source.map((line) => (
                    <tr key={line.source}>
                      <th scope="row">{line.label}</th>
                      <td>{line.sent}</td>
                      <td>{line.in_app}</td>
                      <td>{line.sms}</td>
                      <td>{line.read}</td>
                      <td>{line.conversations}</td>
                      <td>{line.deals}</td>
                      <td>{pct(line.read_rate) ?? '—'}</td>
                      <td>{pct(line.conversation_rate) ?? '—'}</td>
                      <td>{pct(line.deal_rate) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.chartNote}>
              A dash is a rate with no denominator yet (nothing sent, or no alert old enough).
            </p>
          </section>

          <section className={styles.group} aria-labelledby="ma-trend">
            <h2 id="ma-trend" className={styles.groupTitle}>
              Over time
            </h2>
            <div className={styles.charts}>
              <SeriesChart def={TREND} bucket={report.trend.bucket} value={trendValue} />
            </div>
            <details className="no-print">
              <summary>Deals per period</summary>
              <table className={styles.legend}>
                <thead>
                  <tr>
                    <th scope="col">{ANALYTICS_BUCKET_LABELS[report.trend.bucket]}</th>
                    <th scope="col">Alerts sent</th>
                    <th scope="col">Conversations</th>
                    <th scope="col">Deals</th>
                  </tr>
                </thead>
                <tbody>
                  {report.trend.periods.map((p, i) => (
                    <tr key={p}>
                      <th scope="row">{periodLabel(p, report.trend.bucket)}</th>
                      <td>{report.trend.sent[i]}</td>
                      <td>{report.trend.conversations[i]}</td>
                      <td>{report.trend.deals[i]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>

          <section className={styles.group} aria-labelledby="ma-limits">
            <h2 id="ma-limits" className={styles.groupTitle}>
              Limitations
            </h2>
            <ul className={styles.limits}>
              {report.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>

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
                </tr>
              </thead>
              <tbody>
                {MATCH_ALERT_METRICS.map((def) => (
                  <tr key={def.id}>
                    <th scope="row">{def.label}</th>
                    <td>{def.definition}</td>
                    <td>{def.denominator}</td>
                    <td>{def.source}</td>
                    <td>{def.window}</td>
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
