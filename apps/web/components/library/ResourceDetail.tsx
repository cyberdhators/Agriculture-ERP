'use client';

import { useState } from 'react';

import type { LearningResourceRow } from '@/lib/fixtures/p1';
import {
  CROP_LABELS,
  FORMAT_LABELS,
  LANGUAGE_LABELS,
  TOPIC_LABELS,
  formatBytes,
  formatDate,
} from '@/lib/format';
import { canEdit, usePreview } from '@/lib/preview';

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
import { FormatIcon } from './resource-presentation';

const METERED_WARNING_BYTES = 10 * 1024 * 1024;

export function ResourceDetail({ resource }: { resource: LearningResourceRow }) {
  const { role, removeResource, saveResource, hydrated } = usePreview();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const [message, setMessage] = useState<string | null>(null);

  const editor = hydrated && canEdit(role);
  const headingId = `resource-${resource.id}`;
  const heavy = resource.byte_size >= METERED_WARNING_BYTES;

  function confirmRemove() {
    if (reason.trim().length < 5) {
      setReasonError('Say why this resource is being removed, in a few words.');
      return;
    }
    removeResource(resource.id, reason.trim());
    setConfirming(false);
    setReason('');
    setReasonError(undefined);
    setMessage('Removed (preview). The file stays in storage and the row keeps its history.');
  }

  function togglePublished() {
    saveResource({ ...resource, published: !resource.published });
    setMessage(
      resource.published
        ? 'Unpublished (preview). Officers no longer see this resource.'
        : 'Published (preview). Officers see this resource from their next sync.',
    );
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
            {resource.published ? (
              <Badge tone="leaf" dot>
                Published
              </Badge>
            ) : (
              <Badge tone="sorghum" dot>
                Unpublished
              </Badge>
            )}
          </div>
          <h2 id={headingId} dir="auto">
            {resource.title}
          </h2>
          <p className={styles.detailMeta}>
            {TOPIC_LABELS[resource.topic]}
            {resource.crop ? ` · ${CROP_LABELS[resource.crop]}` : ''} · added{' '}
            {formatDate(resource.uploaded_at)}
          </p>
        </div>
      </div>

      {message ? (
        <div className={styles.detailSection}>
          <Notice kind="success">{message}</Notice>
        </div>
      ) : null}

      {!resource.published ? (
        <div className={styles.detailSection}>
          <Notice kind="warn" title="Not visible to officers">
            Unpublished resources are only seen here. Publish it when it is ready to go to phones.
          </Notice>
        </div>
      ) : null}

      <div className={`${styles.detailActions} no-print`}>
        <Button
          onClick={() =>
            setMessage(
              `Download (preview): in the live portal this opens a signed link to ${resource.storage_path}.`,
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
            <Button variant="secondary" onClick={togglePublished}>
              {resource.published ? 'Unpublish' : 'Publish'}
            </Button>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              <IconRemove size={18} />
              Remove
            </Button>
          </>
        ) : null}
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
          <span className={styles.factValue}>{TOPIC_LABELS[resource.topic]}</span>
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
