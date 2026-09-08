'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';

import { CROP_LABELS, LANGUAGE_LABELS, formatDate, formatPhone } from '@/lib/format';
import {
  canReview,
  daysWaiting,
  duplicatesOf,
  effectiveStatus,
  isEscalated,
  scopeFarmers,
  statusStamp,
  syncStatusOf,
  SYNC_REASON_LABEL,
  STATUS_LABEL,
} from '@/lib/farmers/presentation';
import {
  auditForEntity,
  consentForFarmer,
  coopById,
  cropsForFarm,
  eventsForFarmer,
  activeOfficersInPayam,
  farmerById,
  farmerPayamName,
  farmsForFarmer,
  membershipsForFarmer,
  officerById,
  STATE_NAMES,
  syncForEntity,
  totalAreaHa,
  userById,
} from '@/lib/fixtures/farmers';
import { usePreview } from '@/lib/preview';

import {
  Button,
  ButtonLink,
  Card,
  DefinitionList,
  Dialog,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Select,
  Stamp,
  SyncChip,
  Textarea,
} from '../ui';
import { IconPrint } from '../ui/icons';
import screens from '../screens.module.css';
import styles from './farmers.module.css';
import { Boundary } from './Boundary';
import { DuplicateWarning } from './DuplicateWarning';

const TODAY_YEAR = 2026;

const DECISION_LABEL: Record<string, string> = {
  verified: 'Verified',
  rejected: 'Rejected',
  merged: 'Merged',
};

function maskNid(nid: string): string {
  if (nid.length <= 4) return nid;
  return `${'•'.repeat(Math.max(0, nid.length - 4))}${nid.slice(-4)}`;
}

type ActionKind = 'verify' | 'merge' | 'reject' | 'reassign' | null;

export function FarmerDossier({ id }: { id: string }) {
  const { role, hydrated } = usePreview();
  const farmer = farmerById(id);
  const [action, setAction] = useState<ActionKind>(null);
  const [reason, setReason] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [newOfficer, setNewOfficer] = useState('');
  const [recorded, setRecorded] = useState<string | null>(null);

  const duplicates = useMemo(() => (farmer ? duplicatesOf(farmer) : []), [farmer]);

  if (!farmer) {
    return (
      <>
        <PageHeader eyebrow="Farmers" title="Farmer not found" />
        <EmptyState
          error
          title="No such farmer"
          body="This record is not in the register, or the link is stale."
          actions={<ButtonLink href="/farmers">Back to the register</ButtonLink>}
        />
      </>
    );
  }

  // Scope check: a non-admin may only open a farmer inside their scope.
  const inScope = scopeFarmers([farmer], role).length > 0;
  if (hydrated && !inScope) {
    return (
      <>
        <PageHeader eyebrow="Farmers" title="Outside your scope" />
        <EmptyState
          error
          title="You cannot open this farmer"
          body="This record belongs to a state or caseload outside the one you are previewing. The live portal returns 403."
          actions={<ButtonLink href="/farmers">Back to the register</ButtonLink>}
        />
      </>
    );
  }

  const status = effectiveStatus(farmer);
  const escalated = isEscalated(farmer);
  const consent = consentForFarmer(farmer.id);
  const farms = farmsForFarmer(farmer.id);
  const memberships = membershipsForFarmer(farmer.id);
  const events = eventsForFarmer(farmer.id);
  const audit = auditForEntity(farmer.id);
  const officer = officerById(farmer.registered_by);
  const survivor = farmer.merged_into ? farmerById(farmer.merged_into) : null;
  const age = TODAY_YEAR - farmer.year_of_birth;
  const showActions = hydrated && canReview(role) && status === 'pending';
  // C-8R.2: only an administrator reassigns a caseload, and only to another
  // active officer in the farmer's own payam. `caseload_officer_id` is who
  // works them now; `registered_by` is history and stands in when it is absent.
  const caseloadOfficerId = farmer.caseload_officer_id ?? farmer.registered_by;
  const caseloadOfficer = officerById(caseloadOfficerId);
  const reassignTargets = activeOfficersInPayam(farmer.payam_id).filter(
    (o) => o.id !== caseloadOfficerId,
  );
  const canReassign = hydrated && role === 'admin' && !survivor;

  function submit(kind: Exclude<ActionKind, null>) {
    const who = `${farmer!.given_name} ${farmer!.family_name}`;
    if (kind === 'verify')
      setRecorded(`Recorded (preview, no server): ${who} verified as a new farmer.`);
    if (kind === 'reject')
      setRecorded(`Recorded (preview, no server): ${who} rejected. Reason: ${reason.trim()}`);
    if (kind === 'merge') {
      const target = farmerById(mergeTarget);
      setRecorded(
        `Recorded (preview, no server): ${who} merged into ${target ? target.farmer_number : mergeTarget}.`,
      );
    }
    if (kind === 'reassign') {
      const target = officerById(newOfficer);
      setRecorded(
        `Recorded (preview, no server): caseload moved to ${target ? target.name : newOfficer}.`,
      );
    }
    setAction(null);
    setReason('');
    setMergeTarget('');
    setNewOfficer('');
  }

  return (
    <>
      <PageHeader
        eyebrow={`Farmers · ${farmerPayamName(farmer.payam_id)}`}
        title={`${farmer.given_name} ${farmer.family_name}`}
        subtitle={
          <span className="mono">
            {farmer.farmer_number} · {STATE_NAMES[farmer.state_id] ?? farmer.state_id}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => window.print()}>
              <IconPrint size={18} />
              Print dossier
            </Button>
            <ButtonLink href="/farmers" variant="secondary">
              Back to register
            </ButtonLink>
          </>
        }
      />

      <div className={styles.dossierGrid}>
        <aside className={styles.dossierSummary}>
          <Card padded>
            <div className={styles.stampRow}>
              <Stamp kind={statusStamp(farmer)}>{STATUS_LABEL[status]}</Stamp>
              {escalated ? <Stamp kind="escalated">Escalated</Stamp> : null}
              {farmer.registration_source === 'self' ? (
                <Stamp kind="info">Self-registered</Stamp>
              ) : null}
            </div>
            <DefinitionList
              items={[
                { term: 'Payam', value: farmerPayamName(farmer.payam_id) },
                { term: 'Registered', value: formatDate(farmer.created_at) },
                {
                  term: 'Days waiting',
                  value:
                    status === 'pending' ? (
                      <span className={`mono ${escalated ? styles.cellWaitEscalated : ''}`}>
                        {daysWaiting(farmer)} days
                      </span>
                    ) : (
                      '—'
                    ),
                },
                { term: 'Registered by', value: officer ? officer.name : 'Self-registration' },
                {
                  term: 'Caseload officer',
                  value: caseloadOfficer ? caseloadOfficer.name : 'Unassigned',
                },
                {
                  term: 'Sync',
                  value: <SyncChip status={syncStatusOf(syncForEntity(farmer.id))} />,
                },
              ]}
            />
          </Card>

          {survivor ? (
            <Notice kind="info" title="This record was merged">
              <p className="small">
                Merged into{' '}
                <Link href={`/farmers/${survivor.id}`} className="mono">
                  {survivor.farmer_number}
                </Link>
                , {survivor.given_name} {survivor.family_name}. It is kept for the record.
              </p>
            </Notice>
          ) : null}

          {duplicates.length > 0 && !survivor ? (
            <DuplicateWarning farmer={farmer} matches={duplicates} />
          ) : null}

          {recorded ? (
            <Notice kind="success" title="Decision recorded">
              <p className="small">{recorded}</p>
            </Notice>
          ) : null}

          {showActions ? (
            <Card padded>
              <p className="label" style={{ marginBottom: 'var(--s-3)' }}>
                Verification
              </p>
              <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
                <Button variant="primary" onClick={() => setAction('verify')}>
                  Verify as new
                </Button>
                <Button variant="secondary" onClick={() => setAction('merge')}>
                  Merge into…
                </Button>
                <Button variant="danger" onClick={() => setAction('reject')}>
                  Reject
                </Button>
              </div>
            </Card>
          ) : null}

          {canReassign ? (
            <Card padded>
              <p className="label" style={{ marginBottom: 'var(--s-3)' }}>
                Caseload
              </p>
              <p className="small muted" style={{ marginBottom: 'var(--s-3)' }}>
                Worked by {caseloadOfficer ? caseloadOfficer.name : 'no officer yet'}.
              </p>
              <Button
                variant="secondary"
                onClick={() => setAction('reassign')}
                disabled={reassignTargets.length === 0}
              >
                Reassign officer
              </Button>
              {reassignTargets.length === 0 ? (
                <p className="small muted" style={{ marginTop: 'var(--s-2)' }}>
                  No other active officer serves this payam.
                </p>
              ) : null}
            </Card>
          ) : null}
        </aside>

        <div className={styles.dossierMain}>
          <Section no="01" title="Identity">
            <DefinitionList
              items={[
                { term: 'Given name', value: <span dir="auto">{farmer.given_name}</span> },
                { term: 'Family name', value: <span dir="auto">{farmer.family_name}</span> },
                { term: 'Sex', value: farmer.sex === 'f' ? 'Female' : 'Male' },
                {
                  term: 'Year of birth',
                  value: (
                    <span className="mono">
                      {farmer.year_of_birth} · {age} yrs
                    </span>
                  ),
                },
                {
                  term: 'Phone',
                  value: (
                    <a href={`tel:${farmer.phone}`} className="mono">
                      {formatPhone(farmer.phone)}
                    </a>
                  ),
                },
                {
                  term: 'National id',
                  value: farmer.national_id ? (
                    <span className="mono">{maskNid(farmer.national_id)}</span>
                  ) : (
                    <span className="muted">None recorded</span>
                  ),
                },
                {
                  term: 'Location',
                  value: `${STATE_NAMES[farmer.state_id] ?? farmer.state_id} › Juba › ${farmerPayamName(farmer.payam_id)}`,
                },
                {
                  term: 'Registration source',
                  value:
                    farmer.registration_source === 'officer'
                      ? 'Registered by an officer'
                      : 'Self-registered',
                },
                { term: 'Registered by', value: officer ? officer.name : 'Self-registration' },
                {
                  term: 'Created',
                  value: <span className="mono">{formatDate(farmer.created_at)}</span>,
                },
              ]}
            />
          </Section>

          <Section no="02" title="Consent">
            {consent ? (
              <DefinitionList
                items={[
                  { term: 'Version', value: <span className="mono">{consent.text_version}</span> },
                  { term: 'Language', value: LANGUAGE_LABELS[consent.language] },
                  {
                    term: 'Granted',
                    value: consent.granted ? formatDate(consent.granted_at) : 'Not granted',
                  },
                  {
                    term: 'Withdrawn',
                    value: consent.withdrawn_at
                      ? formatDate(consent.withdrawn_at)
                      : 'Still in force',
                  },
                ]}
              />
            ) : (
              <p className="muted">No consent on file.</p>
            )}
          </Section>

          <Section
            no="03"
            title="Farms"
            count={`${farms.length} · ${totalAreaHa(farmer.id).toFixed(2)} ha`}
          >
            {farms.length === 0 ? (
              <EmptyState
                title="No farms mapped"
                body="No plot has been walked for this farmer yet. A farm is added from the officer app in the field."
              />
            ) : (
              <div>
                {farms.map((farm) => (
                  <div key={farm.id} className={styles.farmCard}>
                    <Boundary farm={farm} size={360} showArea={false} />
                    <div className={styles.farmFacts}>
                      <div className={styles.farmFactsGrid}>
                        <Mini label="Area" value={`${farm.area_ha.toFixed(2)} ha`} mono />
                        <Mini label="Points" value={String(farm.point_count)} mono />
                        <Mini label="GPS accuracy" value={`±${farm.gps_accuracy_m} m`} mono />
                        <Mini
                          label="Trace"
                          value={
                            <Stamp
                              kind={
                                farm.accuracy_flag === 'good'
                                  ? 'verified'
                                  : farm.accuracy_flag === 'poor'
                                    ? 'pending'
                                    : 'rejected'
                              }
                            >
                              {farm.accuracy_flag}
                            </Stamp>
                          }
                        />
                        <Mini label="Season" value={farm.season} mono />
                        <Mini
                          label="Mapped"
                          value={`${officerById(farm.mapped_by)?.name ?? 'Officer'} · ${formatDate(farm.mapped_at)}`}
                        />
                      </div>
                      <div>
                        <p className="label" style={{ marginBottom: 'var(--s-2)' }}>
                          Crops declared
                        </p>
                        <p>
                          {cropsForFarm(farm.id)
                            .map((d) => CROP_LABELS[d.crop])
                            .join(', ') || '—'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            no="04"
            title="Cooperatives"
            count={memberships.length ? String(memberships.length) : undefined}
          >
            {memberships.length === 0 ? (
              <p className="muted">Not a member of any cooperative.</p>
            ) : (
              <DefinitionList
                items={memberships.map((m) => {
                  const coop = coopById(m.cooperative_id);
                  return {
                    term: coop ? coop.name : m.cooperative_id,
                    value: (
                      <span>
                        {titleCase(m.role)} · joined{' '}
                        <span className="mono">{formatDate(m.joined_at)}</span>
                      </span>
                    ),
                  };
                })}
              />
            )}
          </Section>

          <Section
            no="05"
            title="Verification"
            count={events.length ? String(events.length) : undefined}
          >
            {events.length === 0 ? (
              <p className="muted">Awaiting first review.</p>
            ) : (
              <div className={styles.timeline}>
                {events.map((ev) => {
                  const reviewer = userById(ev.reviewer_id);
                  return (
                    <div key={ev.id} className={styles.timelineRow}>
                      <span className={styles.timelineWhen}>{formatDate(ev.decided_at)}</span>
                      <div className={styles.timelineBody}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--s-2)',
                            flexWrap: 'wrap',
                          }}
                        >
                          <Stamp
                            kind={
                              ev.decision === 'verified'
                                ? 'verified'
                                : ev.decision === 'merged'
                                  ? 'merged'
                                  : 'rejected'
                            }
                          >
                            {DECISION_LABEL[ev.decision]}
                          </Stamp>
                          <span className={styles.timelineMeta}>
                            {reviewer ? reviewer.name : 'Reviewer'} · waited{' '}
                            <span className="mono">{ev.days_waiting}d</span>
                          </span>
                        </div>
                        {ev.reason ? <p className={styles.timelineReason}>{ev.reason}</p> : null}
                        {ev.merge_target_id ? (
                          <p className="small">
                            Survivor:{' '}
                            <Link href={`/farmers/${ev.merge_target_id}`} className="mono">
                              {farmerById(ev.merge_target_id)?.farmer_number ?? ev.merge_target_id}
                            </Link>
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section no="06" title="Sync & audit">
            <p className="label" style={{ marginBottom: 'var(--s-2)' }}>
              Sync per device
            </p>
            <div className={screens.tableWrap}>
              <table className={styles.plainTable}>
                <thead>
                  <tr>
                    <th scope="col">Entity</th>
                    <th scope="col">Device</th>
                    <th scope="col">State</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Tries</th>
                  </tr>
                </thead>
                <tbody>
                  {syncForEntity(farmer.id)
                    .concat(farms.flatMap((f) => syncForEntity(f.id)))
                    .map((s) => (
                      <tr key={s.id}>
                        <td>{s.entity_type}</td>
                        <td className="mono small">{s.device_id}</td>
                        <td>
                          <SyncChip status={s.sync_status} />
                        </td>
                        <td className="small muted">
                          {s.reason_code
                            ? (SYNC_REASON_LABEL[s.reason_code] ?? s.reason_code)
                            : '—'}
                        </td>
                        <td className="mono">{s.attempt_count}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <p className="label" style={{ margin: 'var(--s-5) 0 var(--s-2)' }}>
              Audit trail
            </p>
            <div className={screens.tableWrap}>
              <table className={styles.plainTable}>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Action</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Device</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td className="mono small">{formatDate(a.occurred_at)}</td>
                      <td>{titleCase(a.action.replace(/_/g, ' '))}</td>
                      <td className="small">
                        {officerById(a.actor_id)?.name ?? userById(a.actor_id)?.name ?? 'System'}
                      </td>
                      <td className="mono small">{a.device_id ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      </div>

      {/* ---- Action dialogs ---- */}
      <Dialog
        open={action === 'verify'}
        onClose={() => setAction(null)}
        title="Verify as a new farmer"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => submit('verify')}>
              Verify
            </Button>
          </>
        }
      >
        <p>
          Confirm {farmer.given_name} {farmer.family_name} is a distinct farmer and the record is
          sound. This adds a verification event and counts the farmer toward reach.
        </p>
        <p className="small muted">Preview only; nothing is written to a server.</p>
      </Dialog>

      <Dialog
        open={action === 'merge'}
        onClose={() => setAction(null)}
        title="Merge into another farmer"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => submit('merge')} disabled={mergeTarget === ''}>
              Merge
            </Button>
          </>
        }
      >
        <p>Choose the surviving record. This record is kept but points to the survivor.</p>
        <Field label="Survivor" error={undefined}>
          {(ids) => (
            <Select {...ids} value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
              <option value="">Select the surviving farmer…</option>
              {duplicates.map((d) => (
                <option key={d.farmer.id} value={d.farmer.id}>
                  {d.farmer.farmer_number}, {d.farmer.given_name} {d.farmer.family_name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {duplicates.length === 0 ? (
          <p className="small muted">
            No possible duplicate was flagged for this farmer, so there is no obvious survivor to
            offer here.
          </p>
        ) : null}
      </Dialog>

      <Dialog
        open={action === 'reject'}
        onClose={() => setAction(null)}
        title="Reject this registration"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => submit('reject')}
              disabled={reason.trim() === ''}
            >
              Reject
            </Button>
          </>
        }
      >
        <p>A rejection must say why, so the officer can put it right and re-register.</p>
        <Field label="Reason" error={undefined}>
          {(ids) => (
            <Textarea
              {...ids}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain what is missing or wrong…"
            />
          )}
        </Field>
      </Dialog>

      <Dialog
        open={action === 'reassign'}
        onClose={() => setAction(null)}
        title="Reassign the caseload"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => submit('reassign')}
              disabled={newOfficer === ''}
            >
              Reassign
            </Button>
          </>
        }
      >
        <p>
          Move {farmer.given_name} {farmer.family_name} to another officer. Only active officers in{' '}
          {farmerPayamName(farmer.payam_id)} are offered, because an officer visits only where the
          farmer is. Their farms and visits stay with them.
        </p>
        <Field label="New officer" error={undefined}>
          {(ids) => (
            <Select {...ids} value={newOfficer} onChange={(e) => setNewOfficer(e.target.value)}>
              <option value="">Select an officer…</option>
              {reassignTargets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="small muted">Preview only; nothing is written to a server.</p>
      </Dialog>
    </>
  );
}

function Section({
  no,
  title,
  count,
  children,
}: {
  no: string;
  title: string;
  count?: string;
  children: ReactNode;
}) {
  return (
    <Card as="section" padded className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionNo}>{no}</span>
        <h2>{title}</h2>
        {count ? <span className={styles.sectionCount}>{count}</span> : null}
      </div>
      {children}
    </Card>
  );
}

function Mini({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className={styles.miniFact}>
      <span className="label">{label}</span>
      <span className={`${styles.miniFactValue} ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  );
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
