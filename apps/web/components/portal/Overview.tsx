'use client';

import Link from 'next/link';

import { formatDate } from '@/lib/format';
import { canReview, effectiveStatus, statusStamp } from '@/lib/farmers/presentation';
import { farmerPayamName, officerById } from '@/lib/fixtures/farmers';
import { payamName } from '@/lib/fixtures/p1';
import { useOverview } from '@/lib/portal/overview';
import { ROLE_LABELS, usePreview } from '@/lib/preview';

import { ButtonLink, Card, KpiStrip, Notice, PageHeader, Stamp } from '../ui';
import screens from '../screens.module.css';
import farmers from '../farmers/farmers.module.css';

/**
 * The overview home — one home, role-scoped. Live, it reads what the server
 * computed for this caller (C-10): every count from the summary route, what is
 * waiting from the review queue, the newest registrations from the register.
 * Off live, the fixtures. Pending and rejected are shown apart from verified,
 * never folded in (C-6.8), and no fixture value is printed beside a live row.
 */
export function Overview() {
  const { role, hydrated } = usePreview();
  const data = useOverview(role, hydrated);

  if (!hydrated) return null;

  const scopeNote = data.live
    ? role === 'admin'
      ? 'All states, as the server computed it.'
      : role === 'officer'
        ? 'Your caseload, as the server computed it.'
        : 'Your state, as the server computed it.'
    : role === 'admin'
      ? 'All states (preview data).'
      : role === 'officer'
        ? 'Your caseload (preview data).'
        : 'Your state (preview data).';

  const payam = (id: string) => farmerPayamName(id) || payamName(id) || id;

  return (
    <>
      <PageHeader
        eyebrow={`Overview · ${ROLE_LABELS[role]}`}
        title="The register at a glance"
        subtitle={`Registered farmers, what is waiting on review, and where coverage has reached. ${scopeNote}${
          data.as_of ? ` Figures as of ${formatDate(data.as_of)}.` : ''
        }`}
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

      {data.error ? (
        <Notice kind="error" title="The register could not be read">
          <p className="small">{data.error}</p>
        </Notice>
      ) : null}

      {data.loading ? (
        <p className="muted">Reading the register.</p>
      ) : (
        <>
          <div style={{ marginBottom: 'var(--s-4)' }}>
            <KpiStrip
              label="Register"
              items={[
                { label: 'Farmers in scope', value: data.counts.in_scope },
                { label: 'Verified', value: data.counts.verified },
                {
                  label: 'Pending review',
                  value: data.counts.pending,
                  accent: data.counts.pending > 0,
                },
                {
                  label: 'Escalated',
                  value: data.queue ? data.queue.filter((q) => q.escalated).length : '—',
                  accent: (data.queue?.some((q) => q.escalated) ?? false) || false,
                },
                { label: 'Rejected', value: data.counts.rejected },
              ]}
            />
          </div>

          {data.reach && data.land ? (
            <div style={{ marginBottom: 'var(--s-6)' }}>
              <KpiStrip
                label="Reach and land"
                items={[
                  { label: 'Farmers reached', value: data.reach.farmers_reached },
                  { label: 'Visits', value: data.reach.visits },
                  { label: 'Farms mapped', value: data.land.farms_mapped },
                  { label: 'Hectares', value: Math.round(data.land.hectares) },
                ]}
              />
            </div>
          ) : (
            <div style={{ marginBottom: 'var(--s-6)' }} />
          )}

          <div className={farmers.homeGrid}>
            <div className={farmers.homeStack}>
              <Card as="section" padded>
                <div className={farmers.sectionHead}>
                  <h2 className="label">Waiting on review</h2>
                  {canReview(role) ? (
                    <Link href="/farmers/review" className="small">
                      Open queue →
                    </Link>
                  ) : null}
                </div>
                {data.queueUnavailable ? (
                  <p className="small muted">
                    The review queue is a supervisor&apos;s and an administrator&apos;s. Your
                    pending registrations are on the register.
                  </p>
                ) : !data.queue || data.queue.length === 0 ? (
                  <p className="small muted">Nothing is waiting in your scope.</p>
                ) : (
                  <div className={screens.tableWrap}>
                    <table className={screens.table}>
                      <thead>
                        <tr>
                          <th>Farmer</th>
                          <th>Payam</th>
                          {data.live ? null : <th>Registered by</th>}
                          <th className={screens.tdNum}>Wait</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.queue.slice(0, 8).map((f) => {
                          const officer = data.live ? undefined : officerById(f.registered_by);
                          return (
                            <tr key={f.id}>
                              <td>
                                <Link href={`/farmers/${f.id}`} dir="auto">
                                  {f.given_name} {f.family_name}
                                </Link>
                                <div className="small muted mono">{f.farmer_number}</div>
                              </td>
                              <td className={screens.tdNowrap}>{payam(f.payam_id)}</td>
                              {data.live ? null : (
                                <td className={screens.tdNowrap}>
                                  {officer ? officer.name : 'Self'}
                                </td>
                              )}
                              <td className={screens.tdNum}>{f.days}d</td>
                              <td>
                                <Stamp kind={f.escalated ? 'escalated' : 'pending'}>
                                  {f.escalated ? 'Escalated' : 'Pending'}
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
                  <h2 className="label">Recent registrations</h2>
                  <Link href="/farmers" className="small">
                    All farmers →
                  </Link>
                </div>
                {data.recent.length === 0 ? (
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
                        {data.recent.map((f) => (
                          <tr key={f.id}>
                            <td>
                              <Link href={`/farmers/${f.id}`} dir="auto">
                                {f.given_name} {f.family_name}
                              </Link>
                              <div className="small muted mono">{f.farmer_number}</div>
                            </td>
                            <td className={screens.tdNowrap}>{payam(f.payam_id)}</td>
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
                  <h2 className="label">{data.live ? 'Reach by payam' : 'Coverage by payam'}</h2>
                </div>
                <p className="small muted" style={{ marginBottom: 'var(--s-4)' }}>
                  {data.live
                    ? 'Verified farmers in each payam, and how many of them an officer has reached with a visit. The solid bar is reached.'
                    : 'Verified farmers against verified plus pending, payam by payam. Rejected records are counted beside, never inside.'}
                </p>
                {data.coverage.length === 0 ? (
                  <p className="small muted">No coverage to show in your scope.</p>
                ) : (
                  <div className={farmers.coverage}>
                    {data.coverage.map((row) => {
                      const num = data.live ? row.other : row.verified;
                      const den = data.live ? row.verified : row.other;
                      const pct = den === 0 ? 0 : Math.round((num / den) * 100);
                      const name = payam(row.payamId);
                      return (
                        <div key={row.payamId} className={farmers.coverageRow}>
                          <span className={farmers.coverageName} title={name}>
                            {name}
                          </span>
                          <span
                            className={farmers.coverageTrack}
                            role="img"
                            aria-label={
                              data.live
                                ? `${row.other} of ${row.verified} verified reached in ${name}`
                                : `${row.verified} of ${row.other} verified in ${name}`
                            }
                          >
                            <span className={farmers.coverageFill} style={{ width: `${pct}%` }} />
                          </span>
                          <span className={farmers.coverageValue}>
                            {num}/{den}
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
      )}
    </>
  );
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
