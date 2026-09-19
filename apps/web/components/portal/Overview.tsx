'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import { canReview, effectiveStatus, statusStamp } from '@/lib/farmers/presentation';
import { farmerPayamName, officerById, type Farmer } from '@/lib/fixtures/farmers';
import { payamName } from '@/lib/fixtures/p1';
import { formatDate } from '@/lib/format';
import {
  UNAVAILABLE_METRICS,
  ageBandRows,
  breakdownRows,
  donutSegments,
  donutSummaryText,
  sexRows,
  type StatusKey,
} from '@/lib/portal/dashboard-model';
import { useLocationNames } from '@/lib/portal/locations';
import { useOverview } from '@/lib/portal/overview';
import { createExport, LIVE_REPORTS } from '@/lib/reports/api';
import { usePreview } from '@/lib/preview';

import { Button, ButtonLink, Field, Input, Notice, PageHeader, Stamp } from '../ui';
import {
  CardSkeleton,
  ChartCard,
  DataTable,
  DonutChart,
  LoadingState,
  StatCard,
  StatGrid,
  UnavailableState,
} from '../ui/data';
import { useToast } from '../ui/feedback';
import { IconWarn } from '../ui/icons';
import styles from './dashboard.module.css';

/**
 * THE NATIONAL PROGRAMME OVERVIEW.
 *
 * An administrator returns to this system for reporting, verification, account
 * management, exception handling and investigation — not to browse analytics.
 * So the page answers its questions in the order the job asks them: what needs
 * me, what is waiting, what is the register, how far has it reached, who is in
 * it, what has the field done, and can I trust the figures.
 *
 * EVERY NUMBER COMES FROM ONE REQUEST. `GET /api/reports/summary`, scoped by
 * the server, carries the register counts, reach, land and all six
 * disaggregations. The verification queue is a second request because it is a
 * different question, and the location bundle a third because identifiers are
 * not names. Nothing is fetched twice, and no card fetches on its own.
 *
 * THREE STATES THAT ARE NOT EACH OTHER, EVER.
 *   - a measured zero renders as 0;
 *   - a figure no route carries renders as "Not measured", naming what the
 *     backend would need;
 *   - a failure renders as an error with a way to try again.
 * Collapsing any two of those is how a dashboard comes to report that a state
 * has no farmers when the truth is that nobody counted them.
 */

/** Colours carry no meaning alone: every slice repeats its label and figure. */
const STATUS_COLOURS: Record<StatusKey, string> = {
  verified: 'var(--verified)',
  pending: 'var(--pending)',
  rejected: 'var(--danger)',
  merged: 'var(--neutral)',
};

const SCOPE_BAND: Record<string, string> = {
  admin: 'National scope · all states',
  supervisor: 'State scope · your assigned state',
  read_only: 'State scope · read only',
  officer: 'Caseload scope · farmers you registered',
};

export function Overview() {
  const { role, hydrated } = usePreview();
  const [cutoff, setCutoff] = useState('');
  const data = useOverview(role, hydrated, cutoff || undefined);
  const names = useLocationNames(hydrated);
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  const canExport = role === 'admin' || role === 'supervisor';
  const payam = useCallback(
    (id: string) => names.payam(id) ?? farmerPayamName(id) ?? payamName(id) ?? id,
    [names],
  );

  const donut = useMemo(() => donutSegments(data.counts), [data.counts]);
  const escalated = data.queue ? data.queue.filter((row) => row.escalated).length : null;

  /**
   * Runs the summary export through the route that already records it — who
   * ran it, the query, the filters, the cut-off and the row count (C-10.8).
   * The dashboard does not build a file of its own.
   */
  const runExport = useCallback(async () => {
    setExporting(true);
    try {
      await createExport({ report_type: 'summary', ...(cutoff ? { filters: { cutoff } } : {}) });
      toast.show({
        kind: 'success',
        title: 'Export recorded',
        body: 'It is listed in the export log on the Reports screen.',
      });
    } catch {
      toast.show({
        kind: 'error',
        title: 'The export could not be recorded',
        body: 'Nothing was written. Try again, and tell an administrator if it keeps failing.',
      });
    } finally {
      setExporting(false);
    }
  }, [cutoff, toast]);

  if (!hydrated) return null;

  const preview = !data.live;

  return (
    <div className={styles.stack}>
      <PageHeader
        eyebrow="Overview"
        title="National programme overview"
        subtitle="National view of farmer registration, verification, field activity and programme reach."
        actions={
          <div className={styles.headerControls}>
            {/*
             * An "as of" date, not a range. The summary route's `from`/`to`
             * bound VISITS only; the register counts are cumulative to a
             * cut-off. A range control here would look like it filtered
             * registrations and would quietly not, so the control offered is
             * the one that governs every figure on the page.
             */}
            <Field label="Figures as of" hint={LIVE_REPORTS ? undefined : 'Live figures only'}>
              {(ids) => (
                <Input
                  {...ids}
                  type="date"
                  value={cutoff}
                  max={new Date().toISOString().slice(0, 10)}
                  disabled={!LIVE_REPORTS}
                  onChange={(event) => setCutoff(event.target.value)}
                />
              )}
            </Field>
            <Button
              variant="secondary"
              onClick={data.reload}
              disabled={data.loading || !data.live}
              title={data.live ? undefined : 'Nothing to refresh: these are preview figures.'}
            >
              {data.loading ? 'Refreshing…' : 'Refresh'}
            </Button>
            {canExport && LIVE_REPORTS ? (
              <Button variant="secondary" onClick={() => void runExport()} disabled={exporting}>
                {exporting ? 'Recording…' : 'Export this view'}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className={styles.scopeBand}>
        <span>{SCOPE_BAND[role] ?? 'Scope'}</span>
        <span className={styles.scopeBandNote}>
          {preview ? 'Preview data — no live figures on this deployment.' : null}
          {!preview && data.as_of ? `Figures as of ${formatDate(data.as_of)}.` : null}
        </span>
      </div>

      {data.error ? (
        <Notice kind="error" title="Could not load this information">
          <p className="small">
            The figures could not be read just now.{' '}
            <Button variant="ghost" size="small" onClick={data.reload}>
              Try again
            </Button>
          </p>
        </Notice>
      ) : null}

      {/* ---- 1. What needs my attention ------------------------------- */}
      <section aria-labelledby="attention-h">
        <div className={styles.sectionHead}>
          <h2 id="attention-h" className={styles.sectionTitle}>
            Needs attention
          </h2>
          <p className={styles.sectionNote}>Work that may not be moving without you.</p>
        </div>

        {data.loading ? (
          <CardSkeleton count={3} />
        ) : (
          <div className={styles.exceptionRow}>
            {/* A. Pending verification — measured, and actionable. */}
            {canReview(role) ? (
              <Link
                href="/farmers/review"
                className={`${styles.exceptionCard} ${styles.exceptionCardLink} ${
                  data.counts.pending > 0 ? styles.exceptionCardActive : ''
                }`}
              >
                <span className={styles.exceptionHead}>Pending verification</span>
                <p
                  className={`${styles.exceptionNumber} ${
                    data.counts.pending > 0 ? styles.exceptionNumberAlert : ''
                  }`}
                >
                  {data.counts.pending.toLocaleString('en')}
                </p>
                <p className={styles.exceptionWhy}>
                  Registered and consented, but not yet counted in any reach figure.
                </p>
                <span className={styles.exceptionAction}>Review verification queue →</span>
              </Link>
            ) : (
              <div className={styles.exceptionCard}>
                <span className={styles.exceptionHead}>Pending verification</span>
                <p className={styles.exceptionNumber}>{data.counts.pending.toLocaleString('en')}</p>
                <p className={styles.exceptionWhy}>
                  Verification is a supervisor&apos;s and an administrator&apos;s decision.
                </p>
              </div>
            )}

            {/* B. Waiting more than seven days — measured, from the queue. */}
            {escalated === null ? (
              <div className={`${styles.exceptionCard} ${styles.exceptionCardUnmeasured}`}>
                <span className={styles.exceptionHead}>Waiting more than 7 days</span>
                <p className={styles.exceptionWhy}>
                  <strong>Not measured.</strong> Requires registration-age data, which comes with
                  the verification queue — and the queue is not read in your scope.
                </p>
                <span className={styles.exceptionRequires}>Requires the verification queue.</span>
              </div>
            ) : (
              <Link
                href="/farmers/review"
                className={`${styles.exceptionCard} ${styles.exceptionCardLink} ${
                  escalated > 0 ? styles.exceptionCardActive : ''
                }`}
              >
                <span className={styles.exceptionHead}>Waiting more than 7 days</span>
                <p
                  className={`${styles.exceptionNumber} ${
                    escalated > 0 ? styles.exceptionNumberAlert : ''
                  }`}
                >
                  {escalated.toLocaleString('en')}
                </p>
                <p className={styles.exceptionWhy}>
                  A farmer waiting this long has been visited and entered, and is still not counted.
                </p>
                <span className={styles.exceptionAction}>Open the oldest first →</span>
              </Link>
            )}

            {/* C. Farmers without a working officer — NOT measured anywhere. */}
            <div className={`${styles.exceptionCard} ${styles.exceptionCardUnmeasured}`}>
              <span className={styles.exceptionHead}>
                <IconWarn size={14} /> Farmers without a working officer
              </span>
              <p className={styles.exceptionWhy}>
                <strong>Not measured.</strong> Farmers currently without an active officer cannot
                continue normal field follow-up until reassigned.
              </p>
              <span className={styles.exceptionRequires}>
                Requires officer-assignment status in the summary data.
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ---- 2. Verification workload --------------------------------- */}
      <section aria-labelledby="queue-h">
        <div className={styles.sectionHead}>
          <h2 id="queue-h" className={styles.sectionTitle}>
            {data.queueUnavailable ? 'Recent registrations' : 'Waiting on verification'}
          </h2>
          {canReview(role) ? (
            <Link href="/farmers/review" className="small">
              Open the queue →
            </Link>
          ) : null}
        </div>
        {data.loading ? (
          <LoadingState rows={4} label="Reading the verification queue" />
        ) : (
          <div className={data.queueUnavailable ? undefined : styles.split}>
            {data.queueUnavailable ? null : (
              <DataTable
                caption="Farmers waiting on a verification decision, longest wait first"
                rows={(data.queue ?? []).slice(0, 6)}
                rowKey={(row) => row.id}
                empty={
                  <div className={styles.notes}>
                    <p className="small muted" style={{ margin: 0 }}>
                      No records available — nothing is waiting in this scope.
                    </p>
                  </div>
                }
                columns={[
                  {
                    key: 'farmer',
                    header: 'Farmer',
                    rowHeader: true,
                    render: (row) => (
                      <>
                        <Link href={`/farmers/${row.id}`} className={styles.recordLink} dir="auto">
                          {row.given_name} {row.family_name}
                        </Link>
                        <span className={styles.recordNumber}>{row.farmer_number}</span>
                      </>
                    ),
                  },
                  {
                    key: 'payam',
                    header: 'Payam',
                    nowrap: true,
                    render: (row) => payam(row.payam_id),
                  },
                  { key: 'wait', header: 'Wait', numeric: true, render: (row) => `${row.days}d` },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (row) => (
                      <Stamp kind={row.escalated ? 'escalated' : 'pending'}>
                        {row.escalated ? 'Escalated' : 'Pending'}
                      </Stamp>
                    ),
                  },
                ]}
              />
            )}

            <DataTable
              caption="The most recently registered farmers in this scope"
              captionVisible
              rows={data.recent.slice(0, 6)}
              rowKey={(row) => row.id}
              empty={
                <div className={styles.notes}>
                  <p className="small muted" style={{ margin: 0 }}>
                    No records available.
                  </p>
                </div>
              }
              columns={[
                {
                  key: 'farmer',
                  header: 'Farmer',
                  rowHeader: true,
                  render: (row) => (
                    <>
                      <Link href={`/farmers/${row.id}`} className={styles.recordLink} dir="auto">
                        {row.given_name} {row.family_name}
                      </Link>
                      <span className={styles.recordNumber}>{row.farmer_number}</span>
                    </>
                  ),
                },
                ...(preview
                  ? [
                      {
                        key: 'officer',
                        header: 'Registered by',
                        nowrap: true,
                        render: (row: Farmer) =>
                          officerById(row.registered_by ?? '')?.name ?? 'Self',
                      },
                    ]
                  : []),
                {
                  key: 'registered',
                  header: 'Registered',
                  nowrap: true,
                  render: (row) => formatDate(row.created_at),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (row) => (
                    <Stamp kind={statusStamp(row)}>{titleCase(effectiveStatus(row))}</Stamp>
                  ),
                },
              ]}
            />
          </div>
        )}
      </section>

      {/* ---- 3 & 4. The register, and what it is made of --------------- */}
      <section aria-labelledby="register-h">
        <div className={styles.sectionHead}>
          <h2 id="register-h" className={styles.sectionTitle}>
            Farmer register
          </h2>
          <p className={styles.sectionNote}>
            Four populations, counted apart. They are not interchangeable and never summed.
          </p>
        </div>

        {data.loading ? (
          <CardSkeleton count={4} />
        ) : (
          <>
            <StatGrid>
              <StatCard
                label="Verified"
                value={data.counts.verified}
                note="Included in donor reporting."
              />
              <StatCard
                label="Pending"
                value={data.counts.pending}
                note="Awaiting verification."
                attention={data.counts.pending > 0}
              />
              <StatCard
                label="Rejected"
                value={data.counts.rejected}
                note="Not included in reach."
              />
              <StatCard
                label="Merged"
                value={data.counts.merged}
                note="Historical records consolidated."
              />
            </StatGrid>

            <div className={styles.split} style={{ marginBlockStart: 'var(--s-6)' }}>
              <ChartCard
                title="Register composition"
                note="Pending, rejected and merged records are shown separately from verified reach."
              >
                {donut ? (
                  <DonutChart
                    slices={donut.map((segment) => ({
                      ...segment,
                      color: STATUS_COLOURS[segment.key],
                    }))}
                    summaryText={donutSummaryText(donut)}
                    centreValue={data.counts.verified.toLocaleString('en')}
                    centreLabel="Verified"
                  />
                ) : (
                  <p className="small muted">
                    No records available — nothing has been registered in this scope yet.
                  </p>
                )}
              </ChartCard>

              <ChartCard
                title="Registration activity"
                note="Registrations and decisions over time."
              >
                <UnavailableState title="Historical activity is not available">
                  This view will appear when historical registration data is available. The summary
                  route answers a single cut-off rather than a series, so there is nothing to plot
                  without inventing it.
                </UnavailableState>
              </ChartCard>
            </div>
          </>
        )}
      </section>

      {/* ---- 5. Programme reach --------------------------------------- */}
      <section aria-labelledby="reach-h">
        <div className={styles.sectionHead}>
          <h2 id="reach-h" className={styles.sectionTitle}>
            Programme reach
          </h2>
          <p className={styles.sectionNote}>
            Verified farmers by place. Counts only — no ranking is implied.
          </p>
        </div>

        {data.loading ? (
          <LoadingState rows={5} label="Reading programme reach" />
        ) : data.by === null ? (
          <UnavailableState>
            Breakdowns by place are served with the summary figures, which could not be read.
          </UnavailableState>
        ) : (
          <div className={styles.splitWide}>
            <ChartCard
              title="Verified farmers by state"
              note="Each bar is one state's verified count."
              data={breakdownRows(data.by.state, names.state).map((row) => ({
                key: row.key,
                label: row.label,
                value: row.value,
              }))}
              empty="No records available for any state in this scope."
            />
            <div className={styles.panelStack}>
              <ChartCard
                title="By county"
                note="The ten largest counties by verified count."
                data={breakdownRows(data.by.county, names.county, 10).map((row) => ({
                  key: row.key,
                  label: row.label,
                  value: row.value,
                }))}
                empty="No records available."
              />
              <ChartCard
                title="By payam"
                note="The ten largest payams by verified count."
                data={breakdownRows(data.by.payam, names.payam, 10).map((row) => ({
                  key: row.key,
                  label: row.label,
                  value: row.value,
                }))}
                empty="No records available."
              />
            </div>
          </div>
        )}
      </section>

      {/* ---- 6. Demographics ------------------------------------------ */}
      <section aria-labelledby="demographics-h">
        <div className={styles.sectionHead}>
          <h2 id="demographics-h" className={styles.sectionTitle}>
            Farmer demographics
          </h2>
          <p className={styles.sectionNote}>The composition of verified reach.</p>
        </div>

        {data.loading ? (
          <LoadingState rows={4} label="Reading demographics" />
        ) : data.by === null ? (
          <UnavailableState>
            Disaggregations are served with the summary figures, which could not be read.
          </UnavailableState>
        ) : (
          <div className={styles.split}>
            <ChartCard
              title="By sex"
              note="Verified farmers."
              data={sexRows(data.by.sex).map((row) => ({
                key: row.key,
                label: row.label,
                value: row.value,
              }))}
              empty="No records available."
            />
            <ChartCard
              title="By age band"
              note="Bands are computed from a year of birth at the cut-off, so each is approximate to within a year."
              data={ageBandRows(data.by.age_band).map((row) => ({
                key: row.key,
                label: row.label,
                value: row.value,
              }))}
              empty="No records available."
            />
          </div>
        )}
      </section>

      {/* ---- 7. Field activity ---------------------------------------- */}
      <section aria-labelledby="field-h">
        <div className={styles.sectionHead}>
          <h2 id="field-h" className={styles.sectionTitle}>
            Field activity
          </h2>
          <p className={styles.sectionNote}>
            What officers have recorded. An administrator reads this; the fieldwork is theirs.
          </p>
        </div>

        {data.loading ? (
          <CardSkeleton count={4} />
        ) : (
          <StatGrid>
            <StatCard
              label="Farms mapped"
              value={data.land ? data.land.farms_mapped : null}
              note="Farms carrying at least one recorded boundary."
              unmeasuredBecause="Served with the summary figures, which could not be read."
            />
            <StatCard
              label="Hectares mapped"
              value={data.land ? Math.round(data.land.hectares) : null}
              note="From recorded boundaries."
              unmeasuredBecause="Served with the summary figures, which could not be read."
            />
            <StatCard
              label="Visits recorded"
              value={data.reach ? data.reach.visits : null}
              note="Up to the cut-off."
              unmeasuredBecause="Served with the summary figures, which could not be read."
              footer={
                <ButtonLink href="/visits" variant="secondary">
                  Open visits
                </ButtonLink>
              }
            />
            <StatCard
              label="GPS accuracy of boundaries"
              value={null}
              unmeasuredBecause="Accuracy grades are recorded per boundary but are not aggregated in the summary."
            />
          </StatGrid>
        )}
      </section>

      {/* ---- 8. Can I trust these figures? ---------------------------- */}
      <section aria-labelledby="notes-h">
        <div className={styles.sectionHead}>
          <h2 id="notes-h" className={styles.sectionTitle}>
            Data notes
          </h2>
        </div>
        <div className={styles.notes}>
          <ul className={styles.notesList}>
            {/*
             * The server's own notes, verbatim. They are part of the reporting
             * contract (C-10), and a dashboard that paraphrases them can drift
             * from what an export of the same figures says.
             */}
            {data.notes.length > 0 ? (
              data.notes.map((note) => <li key={note}>{note}</li>)
            ) : (
              <li>
                Reach counts verified farmers only. Pending, rejected and merged records are shown
                beside it and never folded in.
              </li>
            )}
            <li>
              Figures reflect the summary the server computed for this account and this cut-off.
            </li>
          </ul>

          <div className={styles.notesUnavailable}>
            <p className="label" style={{ marginBlockEnd: 'var(--s-2)' }}>
              Not currently measured
            </p>
            <ul className={styles.notesList}>
              {UNAVAILABLE_METRICS.map((metric) => (
                <li key={metric.label}>
                  <strong>{metric.label}.</strong> {metric.because}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
