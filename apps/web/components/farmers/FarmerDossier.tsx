'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';

import {
  patchFarmerSchema,
  REJECTION_REASONS,
  VERIFICATION_LIMITS,
  type RejectionReason,
} from '@agri-erp/shared';

import { CROP_LABELS, LANGUAGE_LABELS, formatDate, formatPhone } from '@/lib/format';
import { patchFarmer, removeFarmer } from '@/lib/farmers/api';
import {
  correctionFrom,
  patchDiff,
  rejectionOf,
  type CorrectionValues,
} from '@/lib/farmers/correct';
import { useDossier } from '@/lib/farmers/dossier';
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
  LIVE_VERIFICATION,
  mergeFarmer,
  rejectFarmer,
  resubmitFarmer,
  verifyFarmer,
} from '@/lib/farmers/verification';
import { eligibleOfficers, useOfficers } from '@/lib/farmers/caseload';
import { LIVE_REASSIGN, reassignFarmer } from '@/lib/farmers/reassign';
import { MERGE_CONSEQUENCE, MERGE_CONSTRAINT, MERGE_IRREVERSIBLE } from '@/lib/farmers/recovery';
import { totalArea } from '@/lib/farms/api';
import {
  coopById,
  farmerById,
  farmerPayamName,
  officerById,
  STATE_NAMES,
  syncForEntity,
  userById,
  type Farmer,
} from '@/lib/fixtures/farmers';
import { usePreview } from '@/lib/preview';
import { VISIT_TOPIC_LABELS } from '@/lib/visits/fixtures';

import {
  Button,
  ButtonLink,
  Card,
  DefinitionList,
  Dialog,
  EmptyState,
  Field,
  Input,
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

const REASON_LABEL: Record<RejectionReason, string> = {
  duplicate: 'Duplicate of another farmer',
  wrong_location: 'Wrong location',
  incomplete: 'Incomplete record',
  not_a_farmer: 'Not a farmer',
  consent_missing: 'Consent missing',
  other: 'Other',
};

/**
 * C-5.8, both halves of it.
 *
 * The ROUTE decides who may see a national ID, and enforces it by omitting the
 * key — an administrator and the farmer's own caseload officer get the value,
 * everybody else gets no key at all. So by the time a row reaches this screen,
 * a present `national_id` means "you are entitled to read this", and masking it
 * to ••••1234 would withhold from the one reader the rule exists to serve.
 *
 * The three cases below are therefore not interchangeable:
 *   absent  → render NO row. The reader was not told, and a row saying
 *             "None recorded" would be a placeholder for a withheld field.
 *   null    → render "None recorded". Measured: this farmer has no ID on file.
 *   string  → render it, in full.
 */
function nationalIdRow(farmer: Farmer): { term: string; value: ReactNode } | null {
  if (farmer.national_id === undefined) return null;
  return {
    term: 'National id',
    value: farmer.national_id ? (
      <span className="mono">{farmer.national_id}</span>
    ) : (
      <span className="muted">None recorded</span>
    ),
  };
}

type ActionKind =
  'verify' | 'merge' | 'reject' | 'reassign' | 'correct' | 'resubmit' | 'remove' | null;

export function FarmerDossier({ id }: { id: string }) {
  const { role, hydrated, me } = usePreview();
  const data = useDossier(id, role);
  const { farms, live } = data;
  // A correction or resubmission returns the whole row; hold it here rather
  // than refetching the dossier (useDossier exposes no refresh).
  const [override, setOverride] = useState<Farmer | null>(null);
  const farmer = override ?? data.farmer;
  const [correction, setCorrection] = useState<CorrectionValues | null>(null);
  const [correctErrors, setCorrectErrors] = useState<string[]>([]);
  const [resubmitAfter, setResubmitAfter] = useState(true);
  const [action, setAction] = useState<ActionKind>(null);
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState<RejectionReason | ''>('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [recorded, setRecorded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // C-8R: the caseload pointer after a reassignment, held here because the
  // route returns it and the rest of the dossier does not need a refetch.
  const [reassignTarget, setReassignTarget] = useState('');
  /** Set once a soft removal has been recorded, so the page stops offering actions. */
  const [removed, setRemoved] = useState(false);
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const isAdmin = hydrated && role === 'admin';
  const officerList = useOfficers(isAdmin);

  // Duplicate detection reads the fixture register; there is no live route for
  // it yet, so in live mode the merge dialog takes a farmer number instead.
  const duplicates = useMemo(() => (farmer && !live ? duplicatesOf(farmer) : []), [farmer, live]);

  if (farmer === undefined) {
    return (
      <>
        <PageHeader eyebrow="Farmers" title="Loading…" />
        <p className="muted">Reading the farmer record.</p>
      </>
    );
  }

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

  // Scope check. Live, the route already answered 404 for out-of-scope (C-5.8),
  // so a farmer we hold is one we may see; the preview re-scopes fixtures.
  const inScope = live || scopeFarmers([farmer], role).length > 0;
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
  const { consent, memberships, events, audit, visits } = data;
  // C-6.1 / C-5.9 as amended: a rejected record is corrected by the officer
  // who holds it and resubmitted, never re-registered. PATCH admits the admin
  // and the caseload officer; resubmit is the caseload officer's alone.
  const rejection = status === 'rejected' ? rejectionOf(farmer, events) : null;
  const isCaseloadOfficer =
    hydrated && me?.kind === 'officer' && me.id === (farmer.caseload_officer_id ?? '');
  const canResubmit =
    status === 'rejected' && (live ? isCaseloadOfficer : hydrated && role === 'officer');
  const canCorrect = status === 'rejected' && (canResubmit || (hydrated && role === 'admin'));
  const officer = officerById(farmer.registered_by);
  const officerName = officer ? officer.name : live && farmer.registered_by ? 'Officer' : null;
  // Who works the farmer today (C-8R.6): the caseload pointer, which a
  // reassignment moves; registered_by is history and never changes (C-5.9).
  const caseloadId = movedTo ?? farmer.caseload_officer_id;
  const caseloadName =
    officerList.nameOf(caseloadId) ??
    officerById(caseloadId)?.name ??
    (caseloadId ? caseloadId.slice(0, 8) : null);
  const eligible = eligibleOfficers(officerList.officers, farmer.payam_id, caseloadId);
  const canReassign = isAdmin && !farmer.merged_into && status !== 'merged';
  /**
   * DELETE /api/farmers/:id is administrator-only, and soft. A record already
   * merged is not offered for removal: it has already left the active lists,
   * and removing it again would be a second answer to a settled question.
   */
  const canRemove = isAdmin && !farmer.merged_into && status !== 'merged' && !removed;
  const survivor = farmer.merged_into ? farmerById(farmer.merged_into) : null;
  const age = TODAY_YEAR - farmer.year_of_birth;
  const showActions = hydrated && canReview(role) && status === 'pending';
  const actionsLive = live && LIVE_VERIFICATION;

  async function submit(kind: Exclude<ActionKind, null>) {
    const who = `${farmer!.given_name} ${farmer!.family_name}`;
    const preview = actionsLive ? '' : 'Recorded (preview, no server): ';
    const targetLabel = farmerById(mergeTarget)?.farmer_number ?? mergeTarget;
    setBusy(true);
    try {
      if (kind === 'correct' || kind === 'resubmit') {
        const diff = kind === 'correct' && correction ? patchDiff(farmer!, correction) : {};
        const parsed = patchFarmerSchema.safeParse(diff);
        if (!parsed.success) {
          setCorrectErrors(parsed.error.issues.map((i) => i.message));
          return;
        }
        const resubmit = kind === 'resubmit' || (resubmitAfter && canResubmit);
        let next: Farmer = farmer!;
        if (live) {
          if (Object.keys(parsed.data).length > 0)
            next = (await patchFarmer(farmer!.id, parsed.data)).farmer;
          if (resubmit && LIVE_VERIFICATION) next = await resubmitFarmer(farmer!.id);
        } else {
          next = {
            ...farmer!,
            ...parsed.data,
            verification_status: resubmit ? 'pending' : farmer!.verification_status,
          } as Farmer;
        }
        setOverride(next);
        setCorrectErrors([]);
        setRecorded(
          `${live ? '' : 'Recorded (preview, no server): '}${who} ${
            Object.keys(parsed.data).length > 0 ? 'corrected' : 'unchanged'
          }${resubmit ? ' and resubmitted for review' : ''}.`,
        );
        setAction(null);
        return;
      }
      if (kind === 'reassign') {
        const target = eligible.find((o) => o.id === reassignTarget);
        const name = target?.name ?? reassignTarget;
        if (LIVE_REASSIGN) {
          const moved = await reassignFarmer(farmer!.id, reassignTarget);
          setMovedTo(moved.caseload_officer_id);
          setRecorded(`${who} is now worked by ${name}. Farms and visits followed.`);
        } else {
          setMovedTo(reassignTarget);
          setRecorded(`Recorded (preview, no server): ${who} moved to ${name}.`);
        }
        setAction(null);
        setReassignTarget('');
        return;
      }
      if (kind === 'remove') {
        if (live) await removeFarmer(farmer!.id);
        setRemoved(true);
        setRecorded(
          `${live ? '' : 'Recorded (preview, no server): '}${who} removed from active lists and reporting. The record and its history remain.`,
        );
        setAction(null);
        return;
      }
      if (actionsLive) {
        if (kind === 'verify') await verifyFarmer(farmer!.id);
        if (kind === 'merge') await mergeFarmer(farmer!.id, { target_id: mergeTarget });
        if (kind === 'reject')
          await rejectFarmer(farmer!.id, {
            reason_code: reasonCode || undefined,
            note: reason.trim() || undefined,
          });
      }
      if (kind === 'verify') setRecorded(`${preview}${who} verified as a new farmer.`);
      // C-6.3 with the personal-data law: the banner names the fixed reason
      // code and never the free-text note. The note is a sentence about a
      // named person and belongs on the record, not in a message that may be
      // read over a shoulder or copied into a ticket.
      if (kind === 'reject')
        setRecorded(
          `${preview}${who} rejected. Reason: ${reasonCode ? REASON_LABEL[reasonCode] : 'not given'}.`,
        );
      if (kind === 'merge') setRecorded(`${preview}${who} merged into ${targetLabel}.`);
      setAction(null);
      setReason('');
      setReasonCode('');
      setMergeTarget('');
    } catch (e) {
      setRecorded(e instanceof Error ? e.message : 'The decision could not be recorded.');
    } finally {
      setBusy(false);
    }
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
                { term: 'Registered by', value: officerName ?? 'Self-registration' },
                {
                  term: 'Caseload',
                  value: caseloadName ? (
                    <span dir="auto">
                      {caseloadName}
                      {caseloadId && caseloadId !== farmer.registered_by ? (
                        <span className="small muted"> · reassigned</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="muted">Unassigned</span>
                  ),
                },
                ...(live
                  ? []
                  : [
                      {
                        term: 'Sync',
                        value: <SyncChip status={syncStatusOf(syncForEntity(farmer.id))} />,
                      },
                    ]),
              ]}
            />
          </Card>

          {status === 'rejected' ? (
            <Notice kind="warn" title="Rejected">
              <p className="small">
                {rejection
                  ? `${
                      rejection.reason_code
                        ? (REASON_LABEL[rejection.reason_code as RejectionReason] ??
                          rejection.reason_code)
                        : 'Reason'
                    }${rejection.note ? `: ${rejection.note}` : ''}${
                      rejection.decided_at ? ` · ${formatDate(rejection.decided_at)}` : ''
                    }`
                  : 'The reason is not on this record.'}
              </p>
              {canCorrect ? (
                <div className={styles.stampRow} style={{ marginTop: 'var(--s-3)' }}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setCorrection(correctionFrom(farmer));
                      setCorrectErrors([]);
                      setAction('correct');
                    }}
                  >
                    Correct the record…
                  </Button>
                  {canResubmit ? (
                    <Button variant="primary" disabled={busy} onClick={() => submit('resubmit')}>
                      {busy ? 'Working…' : 'Resubmit for review'}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="small muted" style={{ marginTop: 'var(--s-2)' }}>
                  The officer who holds this caseload corrects the record and resubmits it.
                </p>
              )}
            </Notice>
          ) : null}

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

          {canRemove ? (
            <Button variant="danger" onClick={() => setAction('remove')}>
              Remove farmer
            </Button>
          ) : null}
          {canReassign ? (
            <Card padded>
              <p className="label" style={{ marginBottom: 'var(--s-3)' }}>
                Caseload
              </p>
              <Button
                variant="secondary"
                onClick={() => setAction('reassign')}
                disabled={officerList.loading}
              >
                {officerList.loading ? 'Loading officers…' : 'Reassign to another officer…'}
              </Button>
              {officerList.error ? (
                <p className="small muted" style={{ marginTop: 'var(--s-2)' }}>
                  {officerList.error}
                </p>
              ) : null}
            </Card>
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
                ...(nationalIdRow(farmer) ? [nationalIdRow(farmer)!] : []),
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
                { term: 'Registered by', value: officerName ?? 'Self-registration' },
                {
                  term: 'Created',
                  value: <span className="mono">{formatDate(farmer.created_at)}</span>,
                },
              ]}
            />
          </Section>

          <Section no="02" title="Consent">
            {consent === undefined ? (
              <p className="muted">
                Consent is on file (id <span className="mono">{farmer.consent_id}</span>); the
                version, language and dates are not served by a route yet and will appear here when
                they are.
              </p>
            ) : consent ? (
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
            count={`${farms.length} · ${totalArea(farms).toFixed(2)} ha`}
          >
            {data.errors.farms ? (
              <Notice kind="error" title="Could not load farms">
                <p className="small">{data.errors.farms}</p>
              </Notice>
            ) : farms.length === 0 ? (
              <EmptyState
                title="No farms mapped"
                body="No plot has been walked for this farmer yet. A farm is added from the officer app in the field."
              />
            ) : (
              <div>
                {farms.map(({ farm, crops }) => (
                  <div key={farm.id} className={styles.farmCard}>
                    <Boundary farm={farm} size={360} showArea={false} />
                    <div className={styles.farmFacts}>
                      <div className={styles.farmFactsGrid}>
                        {/*
                         * C-7.8: absent means the route did not send it, not
                         * that the figure is zero. "±0 m" is a perfect GPS fix
                         * and was what a supervisor used to be shown.
                         */}
                        <Mini
                          label="Area"
                          value={farm.area_ha === undefined ? '—' : `${farm.area_ha.toFixed(2)} ha`}
                          mono
                        />
                        <Mini
                          label="Points"
                          value={farm.point_count === undefined ? '—' : String(farm.point_count)}
                          mono
                        />
                        <Mini
                          label="GPS accuracy"
                          value={
                            farm.gps_accuracy_m === undefined ? '—' : `±${farm.gps_accuracy_m} m`
                          }
                          mono
                        />
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
                        <p>{crops.map((c) => CROP_LABELS[c]).join(', ') || '—'}</p>
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
            count={memberships?.length ? String(memberships.length) : undefined}
          >
            {memberships === null ? (
              <p className="muted">
                Cooperative membership is not served by a route yet (C-12). It will appear here when
                it is.
              </p>
            ) : memberships.length === 0 ? (
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
            count={events?.length ? String(events.length) : undefined}
          >
            {events === null ? (
              <p className="muted">
                The decision history is not served by a route yet. The current status above is live;
                the timeline of who decided what will appear here when the route exists.
              </p>
            ) : events.length === 0 ? (
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

          <Section no="06" title="Visits" count={visits ? String(visits.length) : undefined}>
            {data.errors.visits ? (
              <Notice kind="error" title="Could not load visits">
                <p className="small">{data.errors.visits}</p>
              </Notice>
            ) : visits === null ? (
              <p className="muted">
                {live
                  ? 'Visits are not switched on for this deployment (NEXT_PUBLIC_USE_LIVE_VISITS).'
                  : 'Extension visits appear here once an officer records one. See the Visits log.'}
              </p>
            ) : visits.length === 0 ? (
              <p className="muted">No extension visit has been recorded for this farmer yet.</p>
            ) : (
              <div className={styles.timeline}>
                {visits.map((v) => (
                  <div key={v.id} className={styles.timelineRow}>
                    <span className={styles.timelineWhen}>
                      {formatDate(v.visited_at)}
                      <br />
                      <span className="muted">rec. {formatDate(v.received_at)}</span>
                    </span>
                    <div className={styles.timelineBody}>
                      <span className={styles.timelineMeta}>
                        {v.topics.map((t) => VISIT_TOPIC_LABELS[t]).join(', ')}
                        {v.duration_minutes ? ` · ${v.duration_minutes} min` : ''}
                        {v.attendee_count ? ` · ${v.attendee_count} attended` : ''}
                        {v.attachments.length
                          ? ` · ${v.attachments.length} attachment${v.attachments.length === 1 ? '' : 's'}`
                          : ''}
                      </span>
                      <p className={styles.timelineReason} dir="auto">
                        {v.advice}
                      </p>
                      {v.observation ? (
                        <p className="small muted" dir="auto">
                          {v.observation}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section no="07" title="Sync & audit">
            {live ? (
              <p className="muted" style={{ marginBottom: 'var(--s-4)' }}>
                Per-device sync state is not served by a route yet; the officer app reports it on
                upload (C-9).
              </p>
            ) : (
              <>
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
                        .concat(farms.flatMap(({ farm }) => syncForEntity(farm.id)))
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
              </>
            )}

            <p className="label" style={{ margin: 'var(--s-5) 0 var(--s-2)' }}>
              Audit trail
            </p>
            {audit === null ? (
              <p className="muted">
                {live && role !== 'admin'
                  ? 'The audit trail is read by an administrator.'
                  : 'The audit trail is not switched on for this deployment (NEXT_PUBLIC_USE_LIVE_ADMIN).'}
              </p>
            ) : data.errors.audit ? (
              <Notice kind="error" title="Could not load the audit trail">
                <p className="small">{data.errors.audit}</p>
              </Notice>
            ) : audit.length === 0 ? (
              <p className="muted">No audit entries for this record.</p>
            ) : (
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
                          {a.actor_id
                            ? (officerById(a.actor_id)?.name ??
                              userById(a.actor_id)?.name ??
                              a.actor_id.slice(0, 8))
                            : 'System'}
                        </td>
                        <td className="mono small">{a.device_id ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* ---- Action dialogs ---- */}
      {/*
       * SOFT REMOVAL, SAID PLAINLY.
       *
       * The route stamps `deleted_at`; nothing is destroyed. So the words here
       * are "remove from active lists and reporting", never "delete
       * permanently" — an administrator who believes they have erased a record
       * will answer a data-subject request wrongly, and the history is still
       * there either way. The dialog names the farmer it is about, because a
       * confirmation that says "this record" is a confirmation somebody
       * eventually gives to the wrong one.
       */}
      <Dialog
        open={action === 'remove'}
        onClose={() => setAction(null)}
        title="Remove this farmer?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => submit('remove')} disabled={busy}>
              {busy ? 'Removing…' : 'Remove farmer'}
            </Button>
          </>
        }
      >
        <p>
          Remove{' '}
          <strong>
            {farmer.given_name} {farmer.family_name}
          </strong>{' '}
          <span className="mono">({farmer.farmer_number})</span> from active lists and reporting?
        </p>
        <p className="small muted">
          The record stops appearing in the register, in counts and in exports. Historical
          information — the registration, its consent, farms, visits and the audit trail — remains
          available to authorised users. This is not a permanent deletion.
        </p>
      </Dialog>

      <Dialog
        open={action === 'verify'}
        onClose={() => setAction(null)}
        title="Verify as a new farmer"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => submit('verify')} disabled={busy}>
              {busy ? 'Verifying…' : 'Verify'}
            </Button>
          </>
        }
      >
        <p>
          Confirm {farmer.given_name} {farmer.family_name} is a distinct farmer and the record is
          sound. This adds a verification event and counts the farmer toward reach.
        </p>
        {actionsLive ? null : (
          <p className="small muted">Preview only; nothing is written to a server.</p>
        )}
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
            <Button
              variant="primary"
              onClick={() => submit('merge')}
              disabled={busy || mergeTarget === ''}
            >
              {busy ? 'Merging…' : 'Merge'}
            </Button>
          </>
        }
      >
        {/*
         * The one consequential action that did not say what it does. The
         * client cannot pre-filter the survivor — no route looks a farmer up
         * by number — so the constraint is stated before the act and the
         * server's own refusal is shown if it is broken.
         */}
        <p>Choose the surviving record.</p>
        <p className="small">{MERGE_CONSEQUENCE}</p>
        <Notice kind="warn" title="Before you merge">
          <p className="small">{MERGE_CONSTRAINT}</p>
          <p className="small">{MERGE_IRREVERSIBLE}</p>
        </Notice>
        {live ? (
          <Field
            label="Survivor"
            hint="Paste the surviving farmer's record id (from their dossier address). Duplicate suggestions are not served by a route yet."
            error={undefined}
          >
            {(ids) => (
              <Input
                {...ids}
                className="mono"
                value={mergeTarget}
                placeholder="00000000-0000-0000-0000-000000000000"
                onChange={(e) => setMergeTarget(e.target.value.trim())}
              />
            )}
          </Field>
        ) : (
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
        )}
        {!live && duplicates.length === 0 ? (
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
              disabled={busy || (reasonCode === '' && reason.trim() === '')}
            >
              {busy ? 'Rejecting…' : 'Reject'}
            </Button>
          </>
        }
      >
        <p>
          A rejection must say why, so the caseload officer can correct the record and resubmit it.
        </p>
        <Field label="Reason code" error={undefined}>
          {(ids) => (
            <Select
              {...ids}
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value as RejectionReason | '')}
            >
              <option value="">Choose a reason…</option>
              {REJECTION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Note"
          optional
          hint={`${reason.length} / ${VERIFICATION_LIMITS.noteMax} characters. Shown to the officer.`}
        >
          {(ids) => (
            <Textarea
              {...ids}
              value={reason}
              maxLength={VERIFICATION_LIMITS.noteMax}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain what is missing or wrong…"
            />
          )}
        </Field>
      </Dialog>

      <Dialog
        open={action === 'correct'}
        onClose={() => setAction(null)}
        title="Correct the record"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => submit('correct')}
              disabled={busy || !correction}
            >
              {busy ? 'Saving…' : resubmitAfter && canResubmit ? 'Save and resubmit' : 'Save'}
            </Button>
          </>
        }
      >
        <p>
          Put right what the reviewer flagged. Only the fields you change are sent, and each change
          is recorded with who made it. The farmer number and the registering officer never change.
        </p>
        {correctErrors.length > 0 ? (
          <Notice kind="error" title="Not saved">
            {correctErrors.map((m) => (
              <p key={m} className="small">
                {m}
              </p>
            ))}
          </Notice>
        ) : null}
        {correction ? (
          <>
            <Field label="Given name" error={undefined}>
              {(ids) => (
                <Input
                  {...ids}
                  value={correction.given_name}
                  onChange={(e) => setCorrection({ ...correction, given_name: e.target.value })}
                />
              )}
            </Field>
            <Field label="Family name" error={undefined}>
              {(ids) => (
                <Input
                  {...ids}
                  value={correction.family_name}
                  onChange={(e) => setCorrection({ ...correction, family_name: e.target.value })}
                />
              )}
            </Field>
            <Field label="Sex" error={undefined}>
              {(ids) => (
                <Select
                  {...ids}
                  value={correction.sex}
                  onChange={(e) =>
                    setCorrection({ ...correction, sex: e.target.value as Farmer['sex'] })
                  }
                >
                  <option value="f">Female</option>
                  <option value="m">Male</option>
                </Select>
              )}
            </Field>
            <Field label="Year of birth" error={undefined}>
              {(ids) => (
                <Input
                  {...ids}
                  inputMode="numeric"
                  value={correction.year_of_birth}
                  onChange={(e) => setCorrection({ ...correction, year_of_birth: e.target.value })}
                />
              )}
            </Field>
            <Field label="Phone" error={undefined}>
              {(ids) => (
                <Input
                  {...ids}
                  inputMode="tel"
                  value={correction.phone}
                  onChange={(e) => setCorrection({ ...correction, phone: e.target.value })}
                />
              )}
            </Field>
            <Field label="National ID" hint="Leave empty if the farmer has none." error={undefined}>
              {(ids) => (
                <Input
                  {...ids}
                  value={correction.national_id}
                  onChange={(e) => setCorrection({ ...correction, national_id: e.target.value })}
                />
              )}
            </Field>
            {canResubmit ? (
              <label
                className="small"
                style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}
              >
                <input
                  type="checkbox"
                  checked={resubmitAfter}
                  onChange={(e) => setResubmitAfter(e.target.checked)}
                />
                Resubmit for review after saving
              </label>
            ) : null}
          </>
        ) : null}
      </Dialog>

      <Dialog
        open={action === 'reassign'}
        onClose={() => setAction(null)}
        title="Reassign to another officer"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => submit('reassign')}
              disabled={busy || reassignTarget === ''}
            >
              {busy ? 'Moving…' : 'Reassign'}
            </Button>
          </>
        }
      >
        <p>
          Move {farmer.given_name} {farmer.family_name}&apos;s caseload to another officer. Only
          active officers in {farmerPayamName(farmer.payam_id)} can take them, because an officer
          who is not where the farmer is cannot visit them. Farms, boundaries and visits follow the
          farmer; the registering officer stays on the record as history.
        </p>
        <Field
          label="New officer"
          hint={
            eligible.length === 0
              ? `No other active officer works ${farmerPayamName(farmer.payam_id)}.`
              : undefined
          }
          error={undefined}
        >
          {(ids) => (
            <Select
              {...ids}
              value={reassignTarget}
              disabled={eligible.length === 0}
              onChange={(e) => setReassignTarget(e.target.value)}
            >
              <option value="">Choose an officer…</option>
              {eligible.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {LIVE_REASSIGN ? null : (
          <p className="small muted">Preview only; nothing is written to a server.</p>
        )}
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
