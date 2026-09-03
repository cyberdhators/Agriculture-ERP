'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { CROP_LABELS, formatPhone, pluralise } from '@/lib/format';
import {
  canReview,
  daysWaiting,
  duplicatesOf,
  isEscalated,
  scopeFarmers,
  ESCALATE_AFTER_DAYS,
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
  Stamp,
  Textarea,
} from '../ui';
import styles from './farmers.module.css';
import { Boundary } from './Boundary';
import { DuplicateWarning } from './DuplicateWarning';

const TODAY_YEAR = 2026;

// Pending pool, computed once from the fixture set.
const FARMERS_PENDING = FARMERS.filter(
  (f) => f.merged_into === null && f.verification_status === 'pending',
);

export function ReviewQueue() {
  const { role, hydrated } = usePreview();
  const [decided, setDecided] = useState<Record<string, string>>({});
  const [reject, setReject] = useState<Farmer | null>(null);
  const [reason, setReason] = useState('');

  const queue = useMemo(() => {
    const pending = scopeFarmers(FARMERS_PENDING, role);
    return pending.sort((a, b) => {
      const ea = isEscalated(a) ? 1 : 0;
      const eb = isEscalated(b) ? 1 : 0;
      if (ea !== eb) return eb - ea;
      return daysWaiting(b) - daysWaiting(a);
    });
  }, [role]);

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

  const escalatedCount = queue.filter((f) => isEscalated(f)).length;

  function record(farmer: Farmer, text: string) {
    setDecided((prev) => ({ ...prev, [farmer.id]: text }));
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

      <div style={{ marginBottom: 'var(--s-6)' }}>
        <KpiStrip
          label="Queue"
          items={[
            { label: 'Pending in scope', value: queue.length },
            { label: 'Escalated', value: escalatedCount, accent: escalatedCount > 0 },
          ]}
        />
      </div>

      {queue.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          body="No farmer in your scope is pending review. New registrations arrive here as officers sync from the field."
          actions={<ButtonLink href="/farmers">Open the register</ButtonLink>}
        />
      ) : (
        <>
          <p className="small muted" style={{ marginBottom: 'var(--s-4)' }} aria-live="polite">
            {pluralise(queue.length, 'farmer')} waiting · {escalatedCount} escalated
          </p>
          <div className={styles.reviewList}>
            {queue.map((farmer) => {
              const farms = farmsForFarmer(farmer.id);
              const duplicates = duplicatesOf(farmer);
              const officer = officerById(farmer.registered_by);
              const escalated = isEscalated(farmer);
              const decision = decided[farmer.id];
              const crops = cropsForFarmer(farmer.id).map((c) => CROP_LABELS[c]);
              return (
                <Card key={farmer.id} padded>
                  <div className={styles.reviewCard}>
                    <div className={styles.reviewHead}>
                      <Stamp kind={escalated ? 'escalated' : 'pending'}>
                        {escalated
                          ? `${daysWaiting(farmer)}d — escalated`
                          : `${daysWaiting(farmer)}d waiting`}
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
                          {officer ? officer.name : 'Self-registered'}
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
                          onClick={() =>
                            record(
                              farmer,
                              `Recorded (preview — no server): ${farmer.given_name} ${farmer.family_name} verified.`,
                            )
                          }
                        >
                          Verify
                        </Button>
                        {duplicates[0] ? (
                          <Button
                            variant="secondary"
                            size="small"
                            onClick={() =>
                              record(
                                farmer,
                                `Recorded (preview — no server): merged into ${duplicates[0]!.farmer.farmer_number}.`,
                              )
                            }
                          >
                            Merge into {duplicates[0].farmer.farmer_number}
                          </Button>
                        ) : null}
                        <Button
                          variant="danger"
                          size="small"
                          onClick={() => {
                            setReject(farmer);
                            setReason('');
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
              disabled={reason.trim() === ''}
              onClick={() => {
                if (reject)
                  record(
                    reject,
                    `Recorded (preview — no server): ${reject.given_name} ${reject.family_name} rejected. Reason: ${reason.trim()}`,
                  );
                setReject(null);
              }}
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
    </>
  );
}
