'use client';

import { useState } from 'react';

import {
  LEARNING_ACTION_NEEDS_PUBLISH,
  LEARNING_NOTE_MIN,
  LEARNING_WORKFLOW_MESSAGES,
  learningEditNeedsPublish,
  learningTransition,
  learningTransitionSchema,
  type LearningAction,
} from '@agri-erp/shared';

import type { LearningResourceRow } from '@/lib/fixtures/p1';
import {
  ADVICE_TOPIC_LABELS,
  CROP_LABELS,
  FORMAT_LABELS,
  LANGUAGE_LABELS,
  formatBytes,
  formatDate,
} from '@/lib/format';
import { useContentAccess } from '@/lib/library/access';
import { usePreview } from '@/lib/preview';

import {
  Badge,
  Button,
  ButtonLink,
  Card,
  DefinitionList,
  Dialog,
  Field,
  Notice,
  Textarea,
} from '../ui';
import { IconEdit, IconPrint, IconRemove, IconUpload } from '../ui/icons';
import styles from '../screens.module.css';
import { FormatIcon, StatusBadge } from './resource-presentation';

const METERED_WARNING_BYTES = 10 * 1024 * 1024;

/** 2026-10-22: the button for each move, and what it says once done. */
const MOVES: Record<LearningAction, { label: string; done: string }> = {
  submit: {
    label: 'Submit for review',
    done: 'Submitted. Someone who can publish reviews it next.',
  },
  return: {
    label: 'Return to draft',
    done: 'Returned to draft with your note. It goes back to review when resubmitted.',
  },
  publish: {
    label: 'Publish',
    done: 'Published. Officers and the public guides page see it from now on.',
  },
  unpublish: {
    label: 'Unpublish',
    done: 'Unpublished. It has left the public guides page and officers no longer see it.',
  },
};

const ACTION_ORDER: readonly LearningAction[] = ['submit', 'publish', 'return', 'unpublish'];

export function ResourceDetail({ resource }: { resource: LearningResourceRow }) {
  const { removeResource, transitionResource } = usePreview();
  const access = useContentAccess();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // 2026-10-22: publishing authority is separately assignable. A guide in
  // review or public is edited and removed only by someone who can publish.
  const locked = learningEditNeedsPublish(resource.status) && !access.publish;
  const editor = access.write && !locked;
  const moves = ACTION_ORDER.filter(
    (a) =>
      learningTransition(resource.status, a) !== null &&
      access.write &&
      (!LEARNING_ACTION_NEEDS_PUBLISH[a] || access.publish),
  );
  const headingId = `resource-${resource.id}`;
  const heavy = resource.byte_size >= METERED_WARNING_BYTES;

  async function confirmRemove() {
    if (reason.trim().length < 5) {
      setReasonError('Say why this resource is being removed, in a few words.');
      return;
    }
    try {
      await removeResource(resource.id, reason.trim());
    } catch (e) {
      setReasonError(e instanceof Error ? e.message : 'The resource could not be removed.');
      return;
    }
    setConfirming(false);
    setReason('');
    setReasonError(undefined);
    setError(null);
    setMessage('Removed. The file stays in storage and the row keeps its history.');
  }

  async function move(action: LearningAction, withNote?: string) {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await transitionResource(resource.id, action, withNote);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change could not be recorded.');
      return;
    } finally {
      setBusy(false);
    }
    setMessage(MOVES[action].done);
  }

  async function confirmReturn() {
    const parsed = learningTransitionSchema.safeParse({ action: 'return', note });
    if (!parsed.success) {
      setNoteError(LEARNING_WORKFLOW_MESSAGES.noteRequired);
      return;
    }
    setNoteError(undefined);
    await move('return', parsed.data.note);
    setReturning(false);
    setNote('');
  }

  return (
    <Card as="article" aria-labelledby={headingId}>
      <div className={styles.detailHead}>
        <span className={styles.formatTile} style={{ width: 64, height: 64, borderRadius: 18 }}>
          <FormatIcon format={resource.format} size={30} />
        </span>
        <div className={styles.detailTitle}>
          <div className={styles.detailBadges}>
            <Badge tone="nile">{FORMAT_LABELS[resource.format]}</Badge>
            <Badge tone="neutral">{LANGUAGE_LABELS[resource.language]}</Badge>
            <StatusBadge status={resource.status} />
          </div>
          <h2 id={headingId} dir="auto">
            {resource.title}
          </h2>
          {resource.title_ar ? (
            <p className={styles.detailMeta} dir="rtl" lang="ar">
              {resource.title_ar}
            </p>
          ) : null}
          <p className={styles.detailMeta}>
            {resource.topics.map((t) => ADVICE_TOPIC_LABELS[t]).join(', ')}
            {resource.crop ? ` · ${CROP_LABELS[resource.crop]}` : ''} · added{' '}
            {formatDate(resource.uploaded_at)}
          </p>
        </div>
      </div>

      {error ? (
        <div className={styles.detailSection}>
          <Notice kind="error">{error}</Notice>
        </div>
      ) : null}

      {message ? (
        <div className={styles.detailSection}>
          <Notice kind="success">{message}</Notice>
        </div>
      ) : null}

      {resource.status === 'draft' && resource.review_note ? (
        <div className={styles.detailSection}>
          <Notice
            kind="warn"
            title={`Returned${resource.reviewed_by_name ? ` by ${resource.reviewed_by_name}` : ''}${
              resource.reviewed_at ? `, ${formatDate(resource.reviewed_at)}` : ''
            }`}
          >
            <span dir="auto">{resource.review_note}</span>
          </Notice>
        </div>
      ) : null}

      {resource.status !== 'published' ? (
        <div className={styles.detailSection}>
          <Notice kind="warn" title="Not visible to officers or the public">
            {resource.status === 'in_review'
              ? 'Waiting for someone who can publish to publish it or return it with a note.'
              : 'Only administrators see it here. Submit it for review when it is ready.'}
          </Notice>
        </div>
      ) : null}

      {locked ? (
        <div className={styles.detailSection}>
          <Notice kind="info" title="Publishing authority needed">
            A guide in review or published can be changed only by someone who can publish.
          </Notice>
        </div>
      ) : null}

      <div className={`${styles.detailActions} no-print`}>
        <Button
          onClick={() =>
            setMessage(
              'Preparing the download. The file opens from a signed link that expires after an hour.',
            )
          }
        >
          <IconUpload size={18} style={{ transform: 'rotate(180deg)' }} />
          Download · {formatBytes(resource.byte_size)}
        </Button>
        {editor ? (
          <>
            <ButtonLink href={`/library/${resource.id}/edit`} variant="secondary">
              <IconEdit size={18} />
              Edit
            </ButtonLink>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              <IconRemove size={18} />
              Remove
            </Button>
          </>
        ) : null}
        {moves.map((a) => (
          <Button
            key={a}
            variant={a === 'publish' || a === 'submit' ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => (a === 'return' ? setReturning(true) : void move(a))}
          >
            {MOVES[a].label}
          </Button>
        ))}
        <Button variant="ghost" onClick={() => window.print()}>
          <IconPrint size={18} />
          Print
        </Button>
      </div>

      {heavy ? (
        <div className={styles.detailSection}>
          <Notice kind="info" title={`${formatBytes(resource.byte_size)} on a metered connection`}>
            Large file. Officers should download it on Wi-Fi at the office before going to the
            field.
          </Notice>
        </div>
      ) : null}

      <div className={styles.facts}>
        <div className={styles.fact}>
          <span className="label">Size</span>
          <span className={`${styles.factValue} num`}>{formatBytes(resource.byte_size)}</span>
          <span className="small muted num">
            {resource.byte_size.toLocaleString('en-GB')} bytes
          </span>
        </div>
        <div className={styles.fact}>
          <span className="label">Language</span>
          <span className={styles.factValue}>{LANGUAGE_LABELS[resource.language]}</span>
          <span className="small muted">{resource.language}</span>
        </div>
        <div className={styles.fact}>
          <span className="label">Topic</span>
          <span className={styles.factValue}>
            {ADVICE_TOPIC_LABELS[resource.topics[0] ?? 'other']}
            {resource.topics.length > 1 ? ` +${resource.topics.length - 1}` : ''}
          </span>
          <span className="small muted">
            {resource.crop ? CROP_LABELS[resource.crop] : 'No specific crop'}
          </span>
        </div>
      </div>

      {resource.description ? (
        <section className={styles.detailSection} aria-label="About">
          <div className={styles.detailSectionHead}>
            <h3>About</h3>
          </div>
          <p className={styles.prose} dir="auto">
            {resource.description}
          </p>
        </section>
      ) : null}

      <section className={styles.detailSection} aria-label="Arabic">
        <div className={styles.detailSectionHead}>
          <h3>Arabic</h3>
          <span className="small muted">shown on the public guides page in Arabic</span>
        </div>
        {resource.description_ar ? (
          <p className={styles.prose} dir="rtl" lang="ar">
            {resource.description_ar}
          </p>
        ) : (
          <p className="small muted">
            {resource.title_ar
              ? 'Arabic title only. Arabic readers see the English summary.'
              : 'Not translated yet. Arabic readers see the English title and summary.'}
          </p>
        )}
      </section>

      <section className={styles.detailSection} aria-label="Review">
        <div className={styles.detailSectionHead}>
          <h3>Review</h3>
        </div>
        <DefinitionList
          items={[
            {
              term: 'Submitted',
              value: resource.submitted_at
                ? `${formatDate(resource.submitted_at)}${resource.submitted_by_name ? ` by ${resource.submitted_by_name}` : ''}`
                : 'Not yet',
            },
            {
              term: 'Published',
              value: resource.published_at
                ? `${formatDate(resource.published_at)}${resource.published_by_name ? ` by ${resource.published_by_name}` : ''}`
                : resource.status === 'published'
                  ? 'Before the review workflow; not recorded'
                  : 'Not yet',
            },
            {
              term: 'Last decision',
              value: resource.reviewed_at
                ? `${formatDate(resource.reviewed_at)}${resource.reviewed_by_name ? ` by ${resource.reviewed_by_name}` : ''}`
                : 'None',
            },
          ]}
        />
      </section>

      <section className={styles.detailSection} aria-label="File">
        <div className={styles.detailSectionHead}>
          <h3>File</h3>
          <span className="small muted">
            stored in Supabase Storage, served through signed links
          </span>
        </div>
        <DefinitionList
          items={[
            { term: 'Path', value: <span className="num small">{resource.storage_path}</span> },
            { term: 'Format', value: FORMAT_LABELS[resource.format] },
            { term: 'Uploaded', value: `${formatDate(resource.uploaded_at)} by programme admin` },
            { term: 'Resource id', value: <span className="num small">{resource.id}</span> },
          ]}
        />
      </section>

      <Dialog
        open={returning}
        onClose={() => setReturning(false)}
        title={`Return “${resource.title}” to draft?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReturning(false)}>
              Keep in review
            </Button>
            <Button onClick={confirmReturn} disabled={busy}>
              Return to draft
            </Button>
          </>
        }
      >
        <p>
          The guide goes back to its writer as a draft. Say what needs to change; the note is shown
          on the guide and kept in the audit trail.
        </p>
        <Field label="Note" error={noteError} hint={`At least ${LEARNING_NOTE_MIN} characters.`}>
          {(ids) => (
            <Textarea
              {...ids}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              dir="auto"
            />
          )}
        </Field>
      </Dialog>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Remove “${resource.title}”?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep resource
            </Button>
            <Button variant="danger" onClick={confirmRemove}>
              <IconRemove size={18} />
              Remove resource
            </Button>
          </>
        }
      >
        <p>
          The resource leaves the library for everyone. The file and the catalogue row are kept with
          your reason; nothing is destroyed.
        </p>
        <Field label="Reason" error={reasonError}>
          {(ids) => (
            <Textarea
              {...ids}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              dir="auto"
            />
          )}
        </Field>
      </Dialog>
    </Card>
  );
}
