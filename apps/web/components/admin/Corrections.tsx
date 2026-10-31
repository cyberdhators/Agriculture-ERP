'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  CORRECTION_LIMITS,
  correctionRequestSchema,
  type CorrectionTarget,
  type ListingCorrection,
} from '@agri-erp/shared';

import { ReasonCodeSelect, useReasonCodes } from '@/components/admin/ReasonCodeSelect';
import { Button, Field, Notice, Select, Stamp, Textarea } from '@/components/ui';
import { ConfirmationDialog } from '@/components/ui/feedback';
import { formatDate } from '@/lib/format';
import { PageLoading } from '@/components/ui/data';

/**
 * REQUEST A CORRECTION (2026-10-27, CORWADO's specification, Marketplace:
 * "Inspect, request correction and moderate with a reason; listing removal is
 * separate from account action"). For staff holding "Moderate content and
 * listings"; POST /api/admin/corrections refuses anyone else.
 *
 * A reason code (CORWADO's list, offered for listings) and a note saying what
 * to fix. The owner is sent a fixed in-app notice and sees the note on their
 * own post. The post STAYS LIVE: removing it is a separate button.
 */

export const TARGET_LABEL: Record<CorrectionTarget, string> = {
  produce_listing: 'Product listing',
  service_listing: 'Service',
  buying_request: 'Buying request',
};

export function RequestCorrectionButton({
  targetType,
  targetId,
  targetTitle,
  onDone,
}: {
  targetType: CorrectionTarget;
  targetId: string;
  targetTitle?: string;
  onDone?: (saved: ListingCorrection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [prefill, setPrefill] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const { loading } = useReasonCodes('listing');

  async function submit() {
    const body = {
      target_type: targetType,
      target_id: targetId,
      reason_code: reasonCode,
      note: note.trim(),
    };
    const parsed = correctionRequestSchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the reason and the note.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/corrections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const answer = (await res.json().catch(() => ({}))) as {
        data?: ListingCorrection;
        error?: { message?: string; fields?: Record<string, string> };
      };
      if (!res.ok || !answer.data) {
        setError(
          Object.values(answer.error?.fields ?? {})[0] ??
            answer.error?.message ??
            `The request was not sent (${res.status}).`,
        );
        return;
      }
      setOpen(false);
      setSent(true);
      setNote('');
      setReasonCode('');
      onDone?.(answer.data);
    } catch {
      setError('The server could not be reached. Nothing was sent.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="small"
        variant="secondary"
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
        disabled={sent}
      >
        {sent ? 'Correction requested' : 'Request a correction'}
      </Button>
      <ConfirmationDialog
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={() => void submit()}
        title="Request a correction"
        consequence={`The owner of ${
          targetTitle ? `"${targetTitle}"` : 'this post'
        } is told to correct it and sees your note on their own post. The post stays on the market; removing it is a separate decision, and so is any action on the account.`}
        confirmLabel="Send request"
        busy={busy}
        confirmDisabled={loading}
      >
        {error ? <Notice kind="error">{error}</Notice> : null}
        <ReasonCodeSelect
          target="listing"
          value={reasonCode}
          onPick={(code, label) => {
            setReasonCode(code);
            const next = code ? `${label}: ` : '';
            if (note.trim() === '' || note === prefill) setNote(next);
            setPrefill(next);
          }}
        />
        <Field
          label="What needs correcting"
          hint={`${CORRECTION_LIMITS.noteMin} to ${CORRECTION_LIMITS.noteMax} characters. The owner sees this note; it is kept in the audit trail.`}
        >
          {(ids) => (
            <Textarea
              {...ids}
              rows={3}
              maxLength={CORRECTION_LIMITS.noteMax}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      </ConfirmationDialog>
    </>
  );
}

/**
 * The moderator's list of correction requests: open ones waiting for their
 * owner, and addressed ones (the owner has edited the post since).
 */
export function CorrectionRequests() {
  const [status, setStatus] = useState<'open' | 'addressed' | ''>('');
  const [rows, setRows] = useState<ListingCorrection[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(() => {
    const query = new URLSearchParams({ limit: '100' });
    if (status) query.set('status', status);
    fetch(`/api/admin/corrections?${query.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          data?: ListingCorrection[];
          error?: { message?: string };
        };
        if (!res.ok) throw new Error(body.error?.message ?? `Not read (${res.status}).`);
        setRows(body.data ?? []);
        setFailure(null);
      })
      .catch((e: unknown) => {
        setRows([]);
        setFailure(e instanceof Error ? e.message : String(e));
      });
  }, [status]);

  useEffect(() => load(), [load]);

  return (
    <section style={{ display: 'grid', gap: 'var(--s-3)', marginBlockStart: 'var(--s-6)' }}>
      <h2>Correction requests</h2>
      <p className="small muted">
        Addressed when the owner edits the post; it stays on the market meanwhile.
      </p>
      <Field label="Show">
        {(ids) => (
          <Select
            {...ids}
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="">All</option>
            <option value="open">Waiting for the owner</option>
            <option value="addressed">Addressed by the owner</option>
          </Select>
        )}
      </Field>
      {failure ? <Notice kind="error">{failure}</Notice> : null}
      {rows === null ? (
        <PageLoading />
      ) : rows.length === 0 ? (
        <p className="small muted">No correction requests.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
          {rows.map((c) => (
            <li
              key={c.id}
              style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}
            >
              <p>
                <strong>{TARGET_LABEL[c.target_type]}:</strong>{' '}
                <span dir="auto">{c.target_title ?? 'Removed'}</span>
              </p>
              <p className="small">
                {c.reason_label} ·{' '}
                <Stamp kind={c.status === 'open' ? 'pending' : 'verified'}>
                  {c.status === 'open' ? 'Waiting for the owner' : 'Addressed'}
                </Stamp>{' '}
                · requested {formatDate(c.requested_at)}
                {c.addressed_at ? ` · edited ${formatDate(c.addressed_at)}` : ''}
              </p>
              <p className="small" dir="auto">
                {c.note}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
