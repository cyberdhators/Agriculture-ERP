'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { REJECTION_REASONS, VERIFICATION_LIMITS, type RejectionReason } from '@agri-erp/shared';

import { CROP_LABELS, formatPhone, pluralise } from '@/lib/format';
import {
  LIVE_VERIFICATION,
  listQueue,
  mergeFarmer,
  rejectFarmer,
  verifyFarmer,
  type QueueItem,
} from '@/lib/farmers/verification';
import {
  canReview,
  daysWaiting,
  duplicatesOf,
  isEscalated,
  scopeFarmers,
  ESCALATE_AFTER_DAYS,
  type DuplicateMatch,
} from '@/lib/farmers/presentation';
import {
  cropsForFarmer,
  farmerPayamName,
  farmsForFarmer,
  officerById,
  totalAreaHa,
  FARMERS,
  type Farmer,
} from '@/lib/fixtures/farmers';
import { ROLE_LABELS, usePreview } from '@/lib/preview';

import {
  Button,
  ButtonLink,
  Card,
  Dialog,
  EmptyState,
  Field,
  KpiStrip,
  Notice,
  PageHeader,
  Select,
  Stamp,
  Textarea,
} from '../ui';
import styles from './farmers.module.css';
import { Boundary } from './Boundary';
import { DuplicateWarning } from './DuplicateWarning';

const TODAY_YEAR = 2026;

const REASON_LABEL: Record<RejectionReason, string> = {
  duplicate: 'Duplicate of an existing farmer',
  wrong_location: 'Wrong location',
  incomplete: 'Incomplete record',
  not_a_farmer: 'Not a farmer',
  consent_missing: 'Consent missing',
  other: 'Other (explain in the note)',
};

// Pending pool, computed once from the fixture set.
const FARMERS_PENDING = FARMERS.filter(
  (f) => f.merged_into === null && f.verification_status === 'pending',
);

/** A queue row normalised across the fixture and live sources. */
type QueueEntry = {
  farmer: Farmer;
  days: number;
  escalated: boolean;
  dups: DuplicateMatch[];
  live: boolean;
};

export function ReviewQueue() {
  const { role, hydrated } = usePreview();
  const [decided, setDecided] = useState<Record<string, string>>({});
  const [reject, setReject] = useState<Farmer | null>(null);
  const [reasonCode, setReasonCode] = useState<RejectionReason | ''>('');
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [liveQueue, setLiveQueue] = useState<QueueItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();

  useEffect(() => {
    if (!LIVE_VERIFICATION) return;
    let live = true;
    listQueue()
      .then((items) => live && (setLiveQueue(items), setLoadError(undefined)))
      .catch(
        (e) => live && setLoadError(e instanceof Error ? e.message : 'Could not load the queue.'),
      );
    return () => {
      live = false;
    };
  }, []);

  // One view model for both sources. Live rows carry the server's own
  // days_waiting / escalated / duplicates (C-6); their farms, crops and officer
  // name come from other backends not yet wired into the queue, so they are
  // left empty rather than recomputed from fixtures against a live id.
  const entries = useMemo(() => {
    const list: QueueEntry[] = LIVE_VERIFICATION
      ? (liveQueue ?? []).map((item) => ({
          farmer: item,
          days: item.days_waiting,
          escalated: item.escalated,
          dups: item.duplicates.map((d) => ({ farmer: d, reason: 'phone' as const })),
          live: true,
        }))
      : scopeFarmers(FARMERS_PENDING, role).map((f) => ({
          farmer: f,
          days: daysWaiting(f),
          escalated: isEscalated(f),
          dups: duplicatesOf(f),
          live: false,
        }));
    return list.sort((a, b) => {
      if (a.escalated !== b.escalated) return a.escalated ? -1 : 1;
      return b.days - a.days;
    });
  }, [role, liveQueue]);

  if (!hydrated) return null;

  if (!canReview(role)) {
    return (
      <>
        <PageHeader eyebrow="Farmers · Verification" title="Review queue" />
        <EmptyState
          error
          title="Only a supervisor or administrator reviews farmers"
          body={`You are previewing as ${ROLE_LABELS[role]}. Verifying, merging and rejecting are review actions; the live portal returns 403 for anyone else.`}
          actions={<ButtonLink href="/farmers">Back to the register</ButtonLink>}
        />
      </>
    );
  }

  const escalatedCount = entries.filter((e) => e.escalated).length;

  function record(farmer: Farmer, text: string) {
    setDecided((prev) => ({ ...prev, [farmer.id]: text }));
  }

  async function onVerify(farmer: Farmer) {
    if (!LIVE_VERIFICATION) {
      record(
        farmer,
        `Recorded (preview, no server): ${farmer.given_name} ${farmer.family_name} verified.`,
      );
      return;
    }
    setBusyId(farmer.id);
    try {
      await verifyFarmer(farmer.id);
      record(farmer, `${farmer.given_name} ${farmer.family_name} verified.`);
    } catch (e) {
      record(farmer, e instanceof Error ? e.message : 'Could not verify.');
    } finally {
      setBusyId(null);
    }
  }

  async function onMerge(farmer: Farmer, targetId: string, targetNumber: string) {
    if (!LIVE_VERIFICATION) {
      record(farmer, `Recorded (preview, no server): merged into ${targetNumber}.`);
      return;
    }
    setBusyId(farmer.id);
    try {
      await mergeFarmer(farmer.id, { target_id: targetId });
      record(farmer, `Merged into ${targetNumber}.`);
    } catch (e) {
      record(farmer, e instanceof Error ? e.message : 'Could not merge.');
    } finally {
      setBusyId(null);
    }
  }

  async function onReject() {
    const target = reject;
    if (!target) return;
    const detail = `${reasonCode ? REASON_LABEL[reasonCode] : 'Other'}${note.trim() ? '. ' + note.trim() : ''}`;
    if (!LIVE_VERIFICATION) {
      record(
        target,
        `Recorded (preview, no server): ${target.given_name} ${target.family_name} rejected. Reason: ${detail}`,
      );
      setReject(null);
      return;
    }
    setBusyId(target.id);
    try {
      await rejectFarmer(target.id, {
        reason_code: reasonCode || undefined,
        note: note.trim() || undefined,
      });
      record(target, `${target.given_name} ${target.family_name} rejected. Reason: ${detail}`);
    } catch (e) {
      record(target, e instanceof Error ? e.message : 'Could not reject.');
    } finally {
      setBusyId(null);
      setReject(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Farmers · Verification"
        title="Review queue"
        subtitle={`Pending farmers, oldest wait first. A wait past ${ESCALATE_AFTER_DAYS} days is escalated and sits at the top.`}
        actions={
          <ButtonLink href="/farmers" variant="secondary">
            Back to register
          </ButtonLink>
        }
      />

      {loadError ? (
        <Notice kind="error" title="Could not load the queue">
          <p className="small">{loadError}</p>
        </Notice>
      ) : null}

      <div style={{ marginBottom: 'var(--s-6)' }}>
        <KpiStrip
          label="Queue"
          items={[
            { label: 'Pending in scope', value: entries.length },
            { label: 'Escalated', value: escalatedCount, accent: escalatedCount > 0 },
          ]}
        />
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          body="No farmer in your scope is pending review. New registrations arrive here as officers sync from the field."
          actions={<ButtonLink href="/farmers">Open the register</ButtonLink>}
        />
      ) : (
        <>
          <p className="small muted" style={{ marginBottom: 'var(--s-4)' }} aria-live="polite">
            {pluralise(entries.length, 'farmer')} waiting · {escalatedCount} escalated
          </p>
          <div className={styles.reviewList}>
            {entries.map((entry) => {
              const { farmer, days, escalated, dups: duplicates, live } = entry;
              const farms = live ? [] : farmsForFarmer(farmer.id);
              const officer = live ? null : officerById(farmer.registered_by);
              const decision = decided[farmer.id];
              const crops = live ? [] : cropsForFarmer(farmer.id).map((c) => CROP_LABELS[c]);
              return (
                <Card key={farmer.id} padded>
                  <div className={styles.reviewCard}>
                    <div className={styles.reviewHead}>
                      <Stamp kind={escalated ? 'escalated' : 'pending'}>
                        {escalated ? `${days}d, escalated` : `${days}d waiting`}
                      </Stamp>
                      <div className={styles.reviewName}>
                        <Link
                          href={`/farmers/${farmer.id}`}
                          className={styles.reviewNameMain}
                          dir="auto"
                        >
                          {farmer.given_name} {farmer.family_name}
                        </Link>
                        <span className="small muted">
                          <span className="mono">{farmer.farmer_number}</span> ·{' '}
                          {farmerPayamName(farmer.payam_id)} · {farmer.sex === 'f' ? 'F' : 'M'}{' '}
                          <span className="mono">{TODAY_YEAR - farmer.year_of_birth}</span> ·{' '}
                          {officer
                            ? officer.name
                            : farmer.registration_source === 'self'
                              ? 'Self-registered'
                              : 'Registered by officer'}
                        </span>
                      </div>
                    </div>

                    <div className={styles.reviewBody}>
                      {farms[0] ? <Boundary farm={farms[0]} size={96} /> : null}
                      <div style={{ display: 'grid', gap: 'var(--s-2)', minWidth: 0 }}>
                        <div className="small">
                          <span className="mono">{formatPhone(farmer.phone)}</span>
                          {' · '}
                          {farms.length
                            ? `${farms.length} farm${farms.length > 1 ? 's' : ''} · ${totalAreaHa(farmer.id).toFixed(2)} ha`
                            : 'no farm mapped'}
                        </div>
                        <div className="small muted">
                          Crops: {crops.length ? crops.join(', ') : '—'}
                        </div>
                        {duplicates.length > 0 ? (
                          <DuplicateWarning farmer={farmer} matches={duplicates} />
                        ) : null}
                      </div>
                    </div>

                    {decision ? (
                      <Notice kind="success" title="Decision recorded">
                        <p className="small">{decision}</p>
                      </Notice>
                    ) : (
                      <div className={styles.reviewActions}>
                        <Button
                          variant="primary"
                          size="small"
                          disabled={busyId === farmer.id}
                          onClick={() => onVerify(farmer)}
                        >
                          Verify
                        </Button>
                        {duplicates[0] ? (
                          <Button
                            variant="secondary"
                            size="small"
                            disabled={busyId === farmer.id}
                            onClick={() =>
                              onMerge(
                                farmer,
                                duplicates[0]!.farmer.id,
                                duplicates[0]!.farmer.farmer_number,
                              )
                            }
                          >
                            Merge into {duplicates[0].farmer.farmer_number}
                          </Button>
                        ) : null}
                        <Button
                          variant="danger"
                          size="small"
                          disabled={busyId === farmer.id}
                          onClick={() => {
                            setReject(farmer);
                            setReasonCode('');
                            setNote('');
                          }}
                        >
                          Reject
                        </Button>
                        <ButtonLink href={`/farmers/${farmer.id}`} variant="ghost" size="small">
                          Open dossier
                        </ButtonLink>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <Dialog
        open={reject !== null}
        onClose={() => setReject(null)}
        title="Reject this registration"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReject(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={reasonCode === '' || busyId !== null}
              onClick={onReject}
            >
              Reject
            </Button>
          </>
        }
      >
        <p>
          A rejection must say why, so the caseload officer can correct the record and resubmit it.
        </p>
        <Field label="Reason">
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
          hint={`${note.length} / ${VERIFICATION_LIMITS.noteMax} characters. Shown to the officer.`}
        >
          {(ids) => (
            <Textarea
              {...ids}
              value={note}
              maxLength={VERIFICATION_LIMITS.noteMax}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Explain what is missing or wrong…"
            />
          )}
        </Field>
      </Dialog>
    </>
  );
}
