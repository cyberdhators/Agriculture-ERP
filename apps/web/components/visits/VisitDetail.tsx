'use client';

import type { AttachmentStatus } from '@agri-erp/shared';

import { Button, Dialog, EmptyState, Stamp, type StampKind } from '@/components/ui';
import { IconAudio, IconImage } from '@/components/ui/icons';
import type { Visit } from '@/lib/visits/api';
import { VISIT_TOPIC_LABELS } from '@/lib/visits/fixtures';
import type { VisitNames } from '@/lib/visits/names';

import styles from './visits.module.css';

const STATUS_STAMP: Record<AttachmentStatus, StampKind> = {
  arrived: 'verified',
  waiting: 'info',
  failed: 'rejected',
};

const STATUS_WORD: Record<AttachmentStatus, string> = {
  arrived: 'Received',
  waiting: 'Waiting',
  failed: 'Failed',
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1000) return `${Math.round(bytes / 1000)} KB`;
  return `${bytes} B`;
}

/**
 * One visit, read in full (C-8.3, C-8.7): who and where, both moments, the
 * topics, the advice and observation, and every attachment with the sentence
 * and stamp the officer sees for its state.
 */
export function VisitDetail({
  visit,
  names,
  onClose,
}: {
  visit: Visit;
  names: VisitNames;
  onClose: () => void;
}) {
  const { farmer: farmerName, officer: officerName, payam: payamName } = names;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Visit"
      footer={
        <Button variant="ghost" type="button" onClick={onClose}>
          Close
        </Button>
      }
    >
      <p className={styles.detailFarmer} dir="auto">
        {farmerName(visit.farmer_id)}
      </p>
      <p className={styles.muted}>
        <span dir="auto">{officerName(visit.officer_id)}</span> · {payamName(visit.payam_id)}
      </p>
      <p className={styles.num}>
        Visited {fmt(visit.visited_at)} · Received {fmt(visit.received_at)}
      </p>
      <p className={styles.topicRow}>
        {visit.topics.map((t) => (
          <Stamp key={t} kind="neutral">
            {VISIT_TOPIC_LABELS[t]}
          </Stamp>
        ))}
      </p>

      <section className={styles.detailSection}>
        <h3>Advice given</h3>
        <p className={styles.prose} dir="auto">
          {visit.advice}
        </p>
      </section>

      {visit.observation ? (
        <section className={styles.detailSection}>
          <h3>What was observed</h3>
          <p className={styles.prose} dir="auto">
            {visit.observation}
          </p>
        </section>
      ) : null}

      {visit.duration_minutes !== null || visit.attendee_count !== null ? (
        <section className={styles.detailSection}>
          <h3>Attendance</h3>
          <p className={styles.num}>
            {visit.duration_minutes !== null ? `${visit.duration_minutes} minutes` : '—'}
            {visit.attendee_count !== null ? ` · ${visit.attendee_count} present` : ''}
          </p>
        </section>
      ) : null}

      <section className={styles.detailSection}>
        <h3>Attachments</h3>
        {visit.attachments.length === 0 ? (
          <EmptyState
            title="No attachments"
            body="This visit was recorded without a photo or a recording."
          />
        ) : (
          <ul className={styles.attachList}>
            {visit.attachments.map((a) => (
              <li key={a.id} className={styles.attachItem}>
                <div className={styles.attachMeta}>
                  <span className={styles.attachKind}>
                    {a.kind === 'photo' ? <IconImage size={16} /> : <IconAudio size={16} />}{' '}
                    {a.kind === 'photo' ? 'Photo' : 'Recording'}
                  </span>
                  <span className={styles.attachSize}>{fmtSize(a.byte_size)}</span>
                  <p className={styles.attachMsg}>{a.message}</p>
                </div>
                <div className={styles.attachRight}>
                  <Stamp kind={STATUS_STAMP[a.status]}>{STATUS_WORD[a.status]}</Stamp>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Dialog>
  );
}
