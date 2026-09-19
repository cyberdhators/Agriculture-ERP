'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { AGE_BANDS, type ReportFilter, type ReportType } from '@agri-erp/shared';

import { CROP_LABELS, formatDate } from '@/lib/format';
import { farmerPayamName, STATE_NAMES } from '@/lib/fixtures/farmers';
import { usePreview } from '@/lib/preview';
import {
  createExport,
  getSummary,
  listExports,
  LIVE_REPORTS,
  ReportApiError,
  type Breakdown,
  type ExportRecord,
  type Summary,
} from '@/lib/reports/api';

import { useLocationNames } from '@/lib/portal/locations';
import { useQueryState } from '@/lib/query-state';
import {
  clearReportFilters,
  describeExport,
  fromQuery,
  reportChips,
  ROW_COUNT_UNKNOWN,
  seasonOptions,
  toReportFilter,
} from '@/lib/reports/report-filters';

import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  KpiStrip,
  Notice,
  PageHeader,
  Select,
} from '../ui';
import screens from '../screens.module.css';
import { EXPORTS_FIXTURE, SUMMARY_FIXTURE } from './fixtures';
import styles from './reports.module.css';

const SEX_LABEL: Record<string, string> = { f: 'Female', m: 'Male' };
const AGE_LABEL: Record<string, string> = Object.fromEntries(
  AGE_BANDS.map((b) => [b.key, b.max === null ? `${b.min} and over` : `${b.min}–${b.max}`]),
);

/**
 * Dashboards, reporting and export (deliverables (p) and (q), C-10). The
 * figures are the server's: reach is verified farmers only, with pending,
 * rejected and merged shown beside it and never folded in (C-10.2, C-10.3);
 * every breakdown is by sex, age band, state, county and payam (C-10.4); no
 * farmer is named anywhere on this page or in any export (C-10.11). An export
 * is a recorded act — the log shows who ran what, with which filters and
 * cut-off, and how many rows (C-10.8). Reads GET /api/reports/summary and
 * /api/reports/exports when NEXT_PUBLIC_USE_LIVE_REPORTS=1; invented figures
 * otherwise (C-10.14).
 */
export function Reports() {
  const { role, hydrated } = usePreview();
  const { get, set } = useQueryState();
  /**
   * The applied filters live in the URL, as they do on the register: a report
   * can then be bookmarked, sent to a colleague, or reopened after following a
   * link out of it — and the chips below are read from the same place, so the
   * two cannot disagree about what is narrowing the figures.
   */
  const urlState = useMemo(() => fromQuery(get), [get]);
  const [draft, setDraft] = useState<ReportFilter>({});
  /** `isoDate` refuses a cut-off later than now, so the picker offers none. */
  const TODAY = new Date().toISOString().slice(0, 10);
  const filter = useMemo(() => toReportFilter(urlState), [urlState]);
  /** Place names for the pickers and the export summary. One fetch, shared. */
  const names = useLocationNames(hydrated);
  /** The export awaiting confirmation. Nothing runs until it is confirmed. */
  const [pendingExport, setPendingExport] = useState<ReportType | null>(null);
  const [summary, setSummary] = useState<Summary | null>(LIVE_REPORTS ? null : SUMMARY_FIXTURE);
  const [exports, setExports] = useState<ExportRecord[]>(LIVE_REPORTS ? [] : EXPORTS_FIXTURE);
  const [loading, setLoading] = useState(LIVE_REPORTS);
  const [error, setError] = useState<string | undefined>();
  const [exportError, setExportError] = useState<string | undefined>();
  const [exporting, setExporting] = useState<ReportType | null>(null);
  const [lastExport, setLastExport] = useState<ExportRecord | null>(null);

  const canExport = hydrated && (role === 'admin' || role === 'supervisor');

  const load = useCallback(async (f: ReportFilter) => {
    if (!LIVE_REPORTS) return;
    setLoading(true);
    setError(undefined);
    try {
      const s = await getSummary(f);
      setSummary(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the figures.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setDraft({
      ...(urlState.cutoff ? { cutoff: urlState.cutoff } : {}),
      ...(urlState.from ? { from: `${urlState.from}T00:00:00Z` } : {}),
      ...(urlState.to ? { to: `${urlState.to}T23:59:59Z` } : {}),
      ...(urlState.season ? { season: urlState.season } : {}),
      ...(urlState.state ? { state: urlState.state } : {}),
      ...(urlState.county ? { county: urlState.county } : {}),
      ...(urlState.payam ? { payam: urlState.payam } : {}),
    });
  }, [urlState]);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  useEffect(() => {
    if (!LIVE_REPORTS || !canExport) return;
    let on = true;
    listExports({ limit: 50 })
      .then((r) => on && setExports(r.exports))
      .catch(() => {
        /* the log is secondary; the figures still stand */
      });
    return () => {
      on = false;
    };
  }, [canExport]);

  function apply() {
    // `draft` holds the form's own shape (dates as dates); the URL holds the
    // same keys, and `toReportFilter` turns them into the schema's timestamps
    // when the request is built. One conversion, in one place.
    set({
      cutoff: draft.cutoff ?? null,
      from: draft.from ? draft.from.slice(0, 10) : null,
      to: draft.to ? draft.to.slice(0, 10) : null,
      season: draft.season ?? null,
      state: draft.state ?? null,
      county: draft.county ?? null,
      payam: draft.payam ?? null,
    });
  }

  function reset() {
    setDraft({});
    set(clearReportFilters());
  }

  /** Remove one chip: clear that key and leave every other filter standing. */
  function removeFilter(key: string) {
    set({ [key]: null });
  }

  async function runExport(type: ReportType) {
    setExporting(type);
    setExportError(undefined);
    setLastExport(null);
    try {
      if (!LIVE_REPORTS) {
        const fake: ExportRecord = {
          id: `preview-${Date.now()}`,
          exported_by: 'you',
          actor_type: role,
          report_type: type,
          query: 'SELECT … (preview, nothing recorded)',
          filters: filter,
          scope: { kind: role === 'admin' ? 'all' : 'state' },
          data_cutoff: filter.cutoff ?? new Date().toISOString().slice(0, 10),
          row_count: type === 'summary' ? 1 : (summary?.farmers.verified ?? 0),
          exported_at: new Date().toISOString(),
        };
        setExports((l) => [fake, ...l]);
        setLastExport(fake);
        return;
      }
      const r = await createExport({ report_type: type, filters: filter });
      setExports((l) => [r.export, ...l]);
      setLastExport(r.export);
      downloadJson(`agrione-${type}-${r.export.data_cutoff}.json`, r.data);
    } catch (e) {
      setExportError(
        e instanceof ReportApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'The export could not be run.',
      );
    } finally {
      setExporting(null);
    }
  }

  const label = (kind: keyof Summary['by'], key: string): string => {
    if (kind === 'sex') return SEX_LABEL[key] ?? key;
    if (kind === 'age_band') return AGE_LABEL[key] ?? key;
    if (kind === 'state') return STATE_NAMES[key] ?? key;
    if (kind === 'payam') return farmerPayamName(key);
    if (kind === 'crop') return CROP_LABELS[key as keyof typeof CROP_LABELS] ?? key;
    return key;
  };

  const activeCount = Object.values(filter).filter(Boolean).length;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Reports"
        title="Reach and coverage"
        subtitle="Verified farmers reached, land mapped and extension coverage, within your scope. Pending, rejected and merged farmers are counted beside every figure, never inside it."
      />

      {/* ---- Filters (the same set an export takes, so the two agree — C-10.9) ---- */}
      <Card padded>
        <div className={styles.filters}>
          <Field label="Data cut-off" hint="Counts are as of this date.">
            {(ids) => (
              <Input
                {...ids}
                type="date"
                max={TODAY}
                value={draft.cutoff ?? ''}
                onChange={(e) => setDraft({ ...draft, cutoff: e.target.value || undefined })}
              />
            )}
          </Field>
          <Field label="Period from" hint="Reach and visits, by the server's moment of receipt.">
            {(ids) => (
              <Input
                {...ids}
                type="date"
                value={draft.from?.slice(0, 10) ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    from: e.target.value ? `${e.target.value}T00:00:00Z` : undefined,
                  })
                }
              />
            )}
          </Field>
          <Field label="Period to">
            {(ids) => (
              <Input
                {...ids}
                type="date"
                value={draft.to?.slice(0, 10) ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    to: e.target.value ? `${e.target.value}T23:59:59Z` : undefined,
                  })
                }
              />
            )}
          </Field>
          {/*
           * A closed list, not a text box. `SEASON_PATTERN` is
           * `YYYY-main` / `YYYY-second`, and this field used to hint "2026A" —
           * a format the schema refuses, so the hint taught the reader to be
           * rejected.
           */}
          <Field label="Season" hint="Latest present if blank.">
            {(ids) => (
              <Select
                {...ids}
                value={draft.season ?? ''}
                onChange={(e) => setDraft({ ...draft, season: e.target.value || undefined })}
              >
                <option value="">Latest present</option>
                {seasonOptions().map((season) => (
                  <option key={season} value={season}>
                    {season}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="State" hint="Narrows within your scope, never beyond it.">
            {(ids) => (
              <Select
                {...ids}
                value={draft.state ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    state: e.target.value || undefined,
                    county: undefined,
                    payam: undefined,
                  })
                }
              >
                <option value="">All states</option>
                {names.states.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="County">
            {(ids) => (
              <Select
                {...ids}
                value={draft.county ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, county: e.target.value || undefined, payam: undefined })
                }
              >
                <option value="">All counties</option>
                {names.countiesIn(draft.state ?? '').map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Payam">
            {(ids) => (
              <Select
                {...ids}
                value={draft.payam ?? ''}
                onChange={(e) => setDraft({ ...draft, payam: e.target.value || undefined })}
              >
                <option value="">All payams</option>
                {names.payamsIn(draft.state ?? '', draft.county ?? '').map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className={styles.apply}>
            <Button variant="primary" onClick={apply} disabled={loading}>
              {loading ? 'Loading…' : 'Apply'}
            </Button>
            {activeCount ? (
              <Button variant="ghost" onClick={reset}>
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {/*
       * ACTIVE FILTERS, EACH SAYING WHAT IT MOVES.
       *
       * "Visits from 1 September" beside a verified count of 12,480 invites
       * the reader to believe those farmers were verified in September. They
       * were not: that is a cumulative total as of the cut-off, and the visit
       * period moves reach and visits alone. The chip carries the distinction
       * so the sentence cannot be misread.
       */}
      {reportChips(urlState, {
        state: names.state,
        county: names.county,
        payam: names.payam,
      }).length > 0 ? (
        <div className={styles.chips}>
          {reportChips(urlState, {
            state: names.state,
            county: names.county,
            payam: names.payam,
          }).map((chip) => (
            <span key={chip.key} className={styles.chip}>
              {chip.label}
              {chip.affects === 'visits' ? (
                <span className={styles.chipScope}>visits only</span>
              ) : null}
              <button
                type="button"
                className={styles.chipRemove}
                onClick={() => removeFilter(chip.key)}
                aria-label={`Remove filter ${chip.label}`}
              >
                ×
              </button>
            </span>
          ))}
          <Button variant="ghost" size="small" onClick={reset}>
            Clear all
          </Button>
        </div>
      ) : null}

      {error ? (
        <Notice kind="error" title="Could not load the figures">
          <p className="small">{error}</p>
        </Notice>
      ) : null}

      {summary ? (
        <>
          <p className={styles.asOf}>
            <span>
              As of <b className="mono">{formatDate(summary.as_of)}</b>
            </span>
            <span>
              Period{' '}
              <b className="mono">
                {summary.period.from ? formatDate(summary.period.from) : 'start'} –{' '}
                {formatDate(summary.period.to)}
              </b>
            </span>
            {summary.season ? (
              <span>
                Season <b className="mono">{summary.season}</b>
              </span>
            ) : null}
            {!LIVE_REPORTS ? <span>Invented figures (preview)</span> : null}
          </p>

          {/* ---- The figures ---- */}
          <Card padded>
            <KpiStrip
              label="Reach"
              items={[
                { label: 'Verified farmers', value: summary.farmers.verified },
                {
                  label: 'Farmers reached',
                  value: summary.reach.farmers_reached,
                  accent: true,
                  delta: `${summary.reach.visits} visits in period`,
                },
                { label: 'Farms mapped', value: summary.land.farms_mapped },
                {
                  label: 'Hectares',
                  value: summary.land.hectares.toFixed(1),
                  delta: `${summary.land.farms_of_verified} farms of verified farmers`,
                },
              ]}
            />
            <div className={styles.beside}>
              <span>
                Beside the verified figure, never inside it: pending{' '}
                <b>{summary.farmers.pending}</b>
              </span>
              <span>
                rejected <b>{summary.farmers.rejected}</b>
              </span>
              <span>
                merged <b>{summary.farmers.merged}</b>
              </span>
              {summary.reach.other_farmers_visited ? (
                <span>
                  visits to non-verified farmers <b>{summary.reach.other_farmers_visited}</b>
                </span>
              ) : null}
            </div>
          </Card>

          {/* ---- Breakdowns (C-10.4) ---- */}
          <div className={styles.grid}>
            <BreakdownTable title="By sex" rows={summary.by.sex} label={(k) => label('sex', k)} />
            <BreakdownTable
              title="By age band"
              rows={summary.by.age_band}
              label={(k) => label('age_band', k)}
              note="Computed at the cut-off from year of birth; approximate to within a year."
            />
            <BreakdownTable
              title="By payam"
              rows={summary.by.payam}
              label={(k) => label('payam', k)}
            />
            <BreakdownTable
              title="By county"
              rows={summary.by.county}
              label={(k) => label('county', k)}
            />
            <BreakdownTable
              title="By state"
              rows={summary.by.state}
              label={(k) => label('state', k)}
            />
            <Card padded>
              <p className="label" style={{ marginBottom: 'var(--s-3)' }}>
                Reach by crop
              </p>
              <table className={styles.breakdown} style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th scope="col">Crop</th>
                    <th scope="col" className={styles.num}>
                      Verified
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.by.crop.map((r) => (
                    <tr key={r.key}>
                      <td>{label('crop', r.key)}</td>
                      <td className={styles.num}>{r.verified}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small muted" style={{ marginTop: 'var(--s-3)' }}>
                A farmer counts once per crop they have a farm declaring this season, so these rows
                do not sum to the total.
              </p>
            </Card>
          </div>

          <ul className={styles.notes}>
            {summary.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      ) : loading ? (
        <p className="muted">Loading the figures…</p>
      ) : null}

      {/*
       * EXPORT CONFIRMATION (C-10.8, C-10.11).
       *
       * An export is a recorded act against real people's records, so it is
       * not a one-click button. This says what will be produced, at what
       * cut-off, under which filters, and — for the farmer list — states the
       * privacy guarantee in the same breath: farmer numbers only, and no
       * name, phone, national ID or rejection note, because the export query
       * does not select them.
       *
       * There is NO row count here. The server counts rows as it builds the
       * export and records the figure in the log; an estimate taken from a
       * page of the register would be a guess dressed as a fact.
       */}
      <Dialog
        open={pendingExport !== null}
        onClose={() => setPendingExport(null)}
        title="Generate export"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingExport(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={exporting !== null}
              onClick={() => {
                const kind = pendingExport;
                setPendingExport(null);
                if (kind) void runExport(kind);
              }}
            >
              {exporting ? 'Running…' : 'Generate export'}
            </Button>
          </>
        }
      >
        {pendingExport ? (
          <>
            <p>
              <strong>{describeExport(pendingExport).title}</strong>
            </p>
            <p className="small">{describeExport(pendingExport).contains}</p>
            <dl className={styles.exportFacts}>
              <dt>Scope</dt>
              <dd>{role === 'admin' ? 'National · all states' : 'Your assigned state'}</dd>
              <dt>Figures as of</dt>
              <dd className="mono">{filter.cutoff ?? 'today'}</dd>
              <dt>Filters</dt>
              <dd>{compactFilters(filter) || 'None'}</dd>
              <dt>Fields</dt>
              <dd className="mono small">{describeExport(pendingExport).columns.join(', ')}</dd>
              <dt>Format</dt>
              <dd>JSON — the only format this route produces.</dd>
              <dt>Rows</dt>
              <dd className="small">{ROW_COUNT_UNKNOWN}</dd>
            </dl>
            <Notice kind="info" title="What leaves the building">
              <p className="small">{describeExport(pendingExport).privacy}</p>
            </Notice>
          </>
        ) : null}
      </Dialog>

      {/* ---- Export log (C-10.8). `id` is where the sidebar's Exports link lands. ---- */}
      {canExport ? (
        <Card padded id="exports">
          <div className={styles.exportHead}>
            <div>
              <p className="label">Exports</p>
              <p className="small muted">
                An export is a recorded act: who ran it, the query, the filters, the cut-off and the
                row count. A farmer list carries farmer numbers only, never a name or phone.
              </p>
            </div>
            <div className={styles.exportActions}>
              <Button
                variant="secondary"
                onClick={() => setPendingExport('summary')}
                disabled={exporting !== null}
              >
                {exporting === 'summary' ? 'Running…' : 'Export these figures'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setPendingExport('farmers')}
                disabled={exporting !== null}
              >
                {exporting === 'farmers' ? 'Running…' : 'Export farmer numbers'}
              </Button>
            </div>
          </div>

          {exportError ? (
            <Notice kind="error" title="Export not run">
              <p className="small">{exportError}</p>
            </Notice>
          ) : null}
          {lastExport ? (
            <Notice kind="success" title="Export recorded">
              <p className="small">
                {lastExport.report_type} · {lastExport.row_count} rows · cut-off{' '}
                <span className="mono">{lastExport.data_cutoff}</span>
                {LIVE_REPORTS
                  ? ' · the file has been downloaded.'
                  : ' (preview, nothing recorded).'}
              </p>
            </Notice>
          ) : null}

          {exports.length === 0 ? (
            <EmptyState title="No exports yet" body="Every export run from here is listed." />
          ) : (
            <div className={screens.tableWrap}>
              <table className={styles.breakdown} style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Report</th>
                    <th scope="col">By</th>
                    <th scope="col">Cut-off</th>
                    <th scope="col" className={styles.num}>
                      Rows
                    </th>
                    <th scope="col">Filters</th>
                  </tr>
                </thead>
                <tbody>
                  {exports.map((e) => (
                    <tr key={e.id}>
                      <td className="mono small">{formatDate(e.exported_at)}</td>
                      <td>{e.report_type}</td>
                      <td className="small">{e.actor_type}</td>
                      <td className="mono small">{e.data_cutoff}</td>
                      <td className={styles.num}>{e.row_count}</td>
                      <td className={styles.filtersInline}>{compactFilters(e.filters)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
  label,
  note,
}: {
  title: string;
  rows: readonly Breakdown[];
  label: (key: string) => string;
  note?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.verified));
  return (
    <Card padded>
      <p className="label" style={{ marginBottom: 'var(--s-3)' }}>
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="small muted">Nothing in scope.</p>
      ) : (
        <table className={styles.breakdown} style={{ width: '100%' }}>
          <thead>
            <tr>
              <th scope="col">{title.replace(/^By /, '')}</th>
              <th scope="col" className={styles.num}>
                Verified
              </th>
              <th scope="col" className={styles.num}>
                Reached
              </th>
              <th scope="col" aria-label="Share of verified" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{label(r.key)}</td>
                <td className={styles.num}>{r.verified}</td>
                <td className={styles.num}>{r.reached}</td>
                <td>
                  <div className={styles.bar} aria-hidden>
                    <div
                      className={styles.barFill}
                      style={{ width: `${(r.verified / max) * 100}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note ? (
        <p className="small muted" style={{ marginTop: 'var(--s-3)' }}>
          {note}
        </p>
      ) : null}
    </Card>
  );
}

function compactFilters(f: unknown): string {
  if (!f || typeof f !== 'object') return '—';
  const parts = Object.entries(f as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${String(v).slice(0, 10)}`);
  return parts.length ? parts.join(' ') : 'none';
}

/** Hand the export payload to the browser as a file. The log row is the record; this is a convenience. */
function downloadJson(name: string, data: unknown) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
