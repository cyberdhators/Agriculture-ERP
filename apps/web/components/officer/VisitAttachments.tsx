'use client';

import { useEffect, useRef, useState } from 'react';

import {
  ATTACHMENT_CONTENT_TYPES,
  ATTACHMENT_STATUS_MESSAGES,
  type AttachmentKind,
} from '@agri-erp/shared';

import { Button } from '@/components/ui';
import {
  confirmAttachment,
  declareAttachment,
  failAttachment,
  getAttachmentLink,
  listVisitAttachments,
  uploadAttachmentBytes,
  type Visit,
  type VisitAttachment,
} from '@/lib/visits/api';

import styles from './officer-visits.module.css';

/**
 * PHOTOS AND RECORDINGS, AFTER THE VISIT EXISTS.
 *
 * THE ORDER IS THE POINT. This component is only ever rendered for a visit
 * that has already been saved, and it takes that visit as a prop rather than
 * an intention. There is no "attach a photo" field inside the visit form,
 * because the API has no such field: the row is declared against a visit id
 * that must already exist.
 *
 * THREE STEPS, AND THE SERVER DECIDES THE LAST. Declare gets a short-lived
 * grant for one object path; the bytes go straight to Storage; confirm asks the
 * server to check what actually landed against what was declared. The phone
 * never gets to assert that a file arrived -- `confirm` compares size and type
 * at the provider and fails the row if they disagree.
 *
 * THE THREE STATES STAY APART. Waiting, arrived and failed are different facts
 * and are shown as different facts, each with the server's own sentence naming
 * what to do. A failed attachment does not remove the visit and does not make
 * it incomplete: the advice was given and is recorded.
 *
 * THIS IS NOT AN OFFLINE QUEUE. Nothing is stored on the device, nothing
 * retries by itself, and closing the screen abandons an upload in progress.
 * "Send it again" is the officer re-declaring the same file, deliberately.
 */
const ACCEPT = [...ATTACHMENT_CONTENT_TYPES.photo, ...ATTACHMENT_CONTENT_TYPES.audio].join(',');

function kindOf(contentType: string): AttachmentKind | null {
  const type = contentType.trim().toLowerCase();
  if ((ATTACHMENT_CONTENT_TYPES.photo as readonly string[]).includes(type)) return 'photo';
  if ((ATTACHMENT_CONTENT_TYPES.audio as readonly string[]).includes(type)) return 'audio';
  return null;
}

export function VisitAttachments({ visit }: { visit: Visit }) {
  const [rows, setRows] = useState<readonly VisitAttachment[]>(visit.attachments);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  /**
   * Open one file. The link is asked for at the moment it is wanted, never in
   * advance for a list: each issue is audited, and a link fetched speculatively
   * would record a reading that never happened.
   */
  async function open(attachment: VisitAttachment) {
    setError(null);
    setOpening(attachment.id);
    try {
      const link = await getAttachmentLink(visit.id, attachment.id);
      window.open(link.url, '_blank', 'noopener,noreferrer');
    } catch (failure) {
      setError(
        (failure as { message?: string })?.message ?? 'This file could not be opened just now.',
      );
    } finally {
      setOpening(null);
    }
  }

  useEffect(() => {
    setRows(visit.attachments);
  }, [visit.attachments]);

  const refresh = () =>
    listVisitAttachments(visit.id)
      .then(setRows)
      .catch(() => {
        /* The list is a courtesy; the states already shown remain true. */
      });

  async function send(file: File) {
    setError(null);
    const kind = kindOf(file.type);
    if (!kind) {
      setError('Send a photo (JPEG, PNG or WebP) or a recording (M4A, AAC, MP3, OGG or WebM).');
      return;
    }
    setBusy(true);
    const id = crypto.randomUUID();
    try {
      // Declare: size and type are judged here, before any byte travels.
      const declared = await declareAttachment(visit.id, {
        id,
        kind,
        content_type: file.type.toLowerCase(),
        byte_size: file.size,
        captured_at: new Date(file.lastModified || Date.now()).toISOString(),
      });
      await refresh();

      if (!declared.upload) {
        // Already arrived: re-declaring an arrived attachment returns it as-is.
        setBusy(false);
        return;
      }

      try {
        await uploadAttachmentBytes(declared.upload, file);
      } catch (uploadFailure) {
        // The phone could not send it. Say so on the row rather than leaving it
        // claiming to be on its way.
        await failAttachment(visit.id, id).catch(() => {});
        await refresh();
        throw uploadFailure;
      }
      await confirmAttachment(visit.id, id);
      await refresh();
    } catch (failure) {
      const message = (failure as { message?: string })?.message;
      setError(message ?? 'This did not send. Try again.');
      await refresh();
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = '';
    }
  }

  return (
    <section className={styles.block} aria-labelledby="attach-h">
      <h2 id="attach-h" className={styles.blockHead}>
        Photos and recordings
      </h2>

      {rows.length === 0 ? (
        <p className={styles.note}>Nothing attached to this visit.</p>
      ) : (
        <ul className={styles.attachments}>
          {rows.map((a) => (
            <li key={a.id} className={styles.attachment}>
              <span className={`${styles.state} ${styles[`state_${a.status}`] ?? ''}`}>
                {a.status === 'arrived'
                  ? 'Received'
                  : a.status === 'waiting'
                    ? 'Waiting'
                    : 'Failed'}
              </span>
              <span className={styles.attachKind}>
                {a.kind === 'photo' ? 'Photo' : 'Recording'}
              </span>
              {/* The server's own sentence, naming the action and never the fault. */}
              <span className={styles.attachMessage}>
                {a.message ?? ATTACHMENT_STATUS_MESSAGES[a.status]}
              </span>
              {/*
                Only an arrived attachment has anything behind it; the route
                answers 409 for the other two states, so the action is not
                offered for them rather than offered and refused.
              */}
              {a.status === 'arrived' ? (
                <Button
                  type="button"
                  variant="secondary"
                  className={styles.openFile}
                  disabled={opening === a.id}
                  onClick={() => void open(a)}
                >
                  {opening === a.id
                    ? 'Opening…'
                    : a.kind === 'photo'
                      ? 'View photo'
                      : 'Play recording'}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}

      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        className={styles.filePicker}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void send(file);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        className={styles.wide}
        disabled={busy}
        onClick={() => picker.current?.click()}
      >
        {busy ? 'Sending…' : 'Add a photo or recording'}
      </Button>
      <p className={styles.note}>
        These send now, over your current connection. If one fails, the visit is still recorded.
      </p>
    </section>
  );
}
