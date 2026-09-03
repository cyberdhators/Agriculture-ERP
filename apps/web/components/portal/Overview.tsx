'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import { formatDate } from '@/lib/format';
import {
  canReview,
  daysWaiting,
  effectiveStatus,
  isEscalated,
  scopeFarmers,
  statusStamp,
  SCOPE_STATE,
} from '@/lib/farmers/presentation';
import {
  FARMERS,
  STATE_NAMES,
  farmerPayamName,
  officerById,
  type Farmer,
} from '@/lib/fixtures/farmers';
import { payamName } from '@/lib/fixtures/p1';
import { ROLE_LABELS, usePreview } from '@/lib/preview';

import { ButtonLink, Card, KpiStrip, PageHeader, Stamp } from '../ui';
import screens from '../screens.module.css';
import farmers from '../farmers/farmers.module.css';

/**
 * The overview home — one home, role-scoped. It reads only the farmer fixtures
 * the current role may see (admin: everyone; supervisor / read-only: their
 * state; officer: their own caseload), and shows what needs attention first:
 * the pending review queue, the newest registrations, and how far coverage has
 * reached across the payams. Every count here obeys the reporting law — pending
 * and rejected are shown apart from verified, never folded in.
 */
export function Overview() {
  const { role, hydrated } = usePreview();

  const scoped = useMemo(() => scopeFarmers(FARMERS, role), [role]);

  const live = useMemo(() => scoped.filter((f) => f.merged_into === null), [scoped]);
  const verified = live.filter((f) => f.verification_status === 'verified');
  const pending = live.filter((f) => f.verification_status === 'pending');
  const escalated = pending.filter((f) => isEscalated(f));

  const queue = useMemo(
    () =>
      [...pending].sort((a, b) => {
        const ea = isEscalated(a) ? 1 : 0;
        const eb = isEscalated(b) ? 1 : 0;
        if (ea !== eb) return eb - ea;
        return daysWaiting(b) - daysWaiting(a);
      }),
    [pending],
  );

  const recent = useMemo(
    () => [...live].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8),
    [live],
  );

  const coverage = useMemo(() => byPayam(live), [live]);

  if (!hydrated) return null;

  const scopeNote =
    role === 'admin'
      ? 'All states.'
      : role === 'officer'
        ? `Your caseload in ${STATE_NAMES[SCOPE_STATE] ?? SCOPE_STATE}.`
        : `${STATE_NAMES[SCOPE_STATE] ?? SCOPE_STATE} only.`;

  return (
    <>
      <PageHeader
        eyebrow={`Overview · ${ROLE_LABELS[role]}`}
        title="The register at a glance"
        subtitle={`Registered farmers, what is waiting on review, and where coverage has reached. ${scopeNote}`}
        actions={
          <>
            <ButtonLink href="/farmers" variant="secondary">
              Open the register
            </ButtonLink>
            {canReview(role) ? (
              <ButtonLink href="/farmers/review" variant="primary">
                Review queue
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <div style={{ marginBottom: 'var(--s-6)' }}>
        <KpiStrip
          label="Register"
          items={[
            { label: 'Farmers in scope', value: live.length },
            { label: 'Verified', value: verified.length },
            { label: 'Pending review', value: pending.length, accent: pending.length > 0 },
            { label: 'Escalated', value: escalated.length, accent: escalated.length > 0 },
          ]}
        />
      </div>

      <div className={farmers.homeGrid}>
        <div className={farmers.homeStack}>
          <Card as="section" padded>
            <div className={farmers.sectionHead}>
              <h2 className="label">
                Waiting on review
              </h2>
              {canReview(role) ? (
                <Link href="/farmers/review" className="small">
                  Open queue →
                </Link>
              ) : null}
            </div>
            {queue.length === 0 ? (
              <p className="small muted">Nothing is waiting in your scope.</p>
            ) : (
              <div className={screens.tableWrap}>
                <table className={screens.table}>
                  <thead>
                    <tr>
                      <th>Farmer</th>
                      <th>Payam</th>
                      <th>Registered by</th>
                      <th className={screens.tdNum}>Wait</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.slice(0, 8).map((f) => {
                      const officer = officerById(f.registered_by);
                      return (
                        <tr key={f.id}>
                          <td>
                            <Link href={`/farmers/${f.id}`} dir="auto">
                              {f.given_name} {f.family_name}
                            </Link>
                            <div className="small muted mono">{f.farmer_number}</div>
                          </td>
                          <td className={screens.tdNowrap}>{farmerPayamName(f.payam_id)}</td>
                          <td className={screens.tdNowrap}>{officer ? officer.name : 'Self'}</td>
                          <td className={screens.tdNum}>{daysWaiting(f)}d</td>
                          <td>
                            <Stamp kind={isEscalated(f) ? 'escalated' : 'pending'}>
                              {isEscalated(f) ? 'Escalated' : 'Pending'}
                            </Stamp>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card as="section" padded>
            <div className={farmers.sectionHead}>
              <h2 className="label">
                Recent registrations
              </h2>
              <Link href="/farmers" className="small">
                All farmers →
              </Link>
            </div>
            {recent.length === 0 ? (
              <p className="small muted">No farmers in your scope yet.</p>
            ) : (
              <div className={screens.tableWrap}>
                <table className={screens.table}>
                  <thead>
                    <tr>
                      <th>Farmer</th>
                      <th>Payam</th>
                      <th>Registered</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((f) => (
                      <tr key={f.id}>
                        <td>
                          <Link href={`/farmers/${f.id}`} dir="auto">
                            {f.given_name} {f.family_name}
                          </Link>
                          <div className="small muted mono">{f.farmer_number}</div>
                        </td>
                        <td className={screens.tdNowrap}>{farmerPayamName(f.payam_id)}</td>
                        <td className={screens.tdNowrap}>{formatDate(f.created_at)}</td>
                        <td>
                          <Stamp kind={statusStamp(f)}>{titleCase(effectiveStatus(f))}</Stamp>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <aside className={farmers.homeAside}>
          <Card as="section" padded>
            <div className={farmers.sectionHead}>
              <h2 className="label">
                Coverage by payam
              </h2>
            </div>
            <p className="small muted" style={{ marginBottom: 'var(--s-4)' }}>
              Verified farmers against the total on the register, payam by payam. The solid bar is
              verified; the muted remainder is pending or rejected.
            </p>
            {coverage.length === 0 ? (
              <p className="small muted">No coverage to show in your scope.</p>
            ) : (
              <div className={farmers.coverage}>
                {coverage.map((row) => {
                  const pct = row.total === 0 ? 0 : Math.round((row.verified / row.total) * 100);
                  return (
                    <div key={row.payamId} className={farmers.coverageRow}>
                      <span className={farmers.coverageName} title={row.name}>
                        {row.name}
                      </span>
                      <span
                        className={farmers.coverageTrack}
                        role="img"
                        aria-label={`${row.verified} of ${row.total} verified in ${row.name}`}
                      >
                        <span className={farmers.coverageFill} style={{ width: `${pct}%` }} />
                      </span>
                      <span className={farmers.coverageValue}>
                        {row.verified}/{row.total}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}

interface CoverageRow {
  payamId: string;
  name: string;
  verified: number;
  total: number;
}

function byPayam(pool: readonly Farmer[]): CoverageRow[] {
  const map = new Map<string, CoverageRow>();
  for (const f of pool) {
    const row =
      map.get(f.payam_id) ??
      { payamId: f.payam_id, name: farmerPayamName(f.payam_id) || payamName(f.payam_id), verified: 0, total: 0 };
    row.total += 1;
    if (f.verification_status === 'verified') row.verified += 1;
    map.set(f.payam_id, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
