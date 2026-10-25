'use client';

import { useCallback, useEffect, useState } from 'react';

import { RequestCorrectionButton } from '@/components/admin/Corrections';
import { ReasonCodeSelect } from '@/components/admin/ReasonCodeSelect';
import { Button, Field, Notice, Stamp, Textarea } from '@/components/ui';
import { ConfirmationDialog } from '@/components/ui/feedback';
import { formatDate } from '@/lib/format';
import { useHolds } from '@/lib/admin/use-permission';
import { usePreview } from '@/lib/preview';
import { reasonLabel, statusLabel, statusTone } from '@/components/product-reports/presentation';

interface MarketReport {
  id: string;
  target_type: 'buying_request' | 'service_listing' | string;
  target_id: string;
  target_title?: string;
  poster_name?: string;
  target_status?: string;
  reason: string;
  status: string;
  created_at: string;
}

/** The written reason a decision needs (2026-10-25); the server keeps up to its own limit. */
const NOTE_MIN = 5;

const TARGET_LABEL: Record<string, string> = {
  buying_request: 'Buying request',
  service_listing: 'Service',
  // 2026-10-23: a published public profile. Staff act on the account (suspend,
  // remove the photo) from the farmer's record or the buyer list.
  profile: 'Public profile',
};

/** Decisions the server allows from each report status (it checks them again). */
const ACTIONS: Record<string, ReadonlyArray<{ action: string; label: string }>> = {
  new: [
    { action: 'mark_reviewing', label: 'Reviewing' },
    { action: 'dismiss', label: 'Dismiss' },
    { action: 'remove_listing', label: 'Remove post' },
  ],
  reviewing: [
    { action: 'resolve', label: 'Resolve' },
    { action: 'dismiss', label: 'Dismiss' },
    { action: 'remove_listing', label: 'Remove post' },
  ],
};

/**
 * LISTINGS LANE (2026-10-19). Reports about buying requests and service
 * listings, beside the product-report queue. Administrator only (the routes
 * refuse anyone else). "Remove post" removes it softly and settles the report;
 * no reporter identity exists to show.
 */
export function MarketReports() {
  const { hydrated } = usePreview();
  // 2026-10-30 (presets are binding): offered to whoever holds content.moderate, on any
  // staff role; the route asks for the same permission.
  const holds = useHolds('content.moderate');
  const isAdmin = hydrated && holds === true;
  const [rows, setRows] = useState<MarketReport[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // 2026-10-25 (settings, phase 1): each decision opens a dialog with a reason
  // code from Settings, which pre-fills the written reason; the reason is
  // required and kept in the audit row with the code.
  const [pending, setPending] = useState<{ id: string; action: string; label: string } | null>(
    null,
  );
  const [reasonCode, setReasonCode] = useState('');
  const [prefill, setPrefill] = useState('');
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | undefined>();

  const load = useCallback(() => {
    fetch('/api/admin/market-reports?limit=100')
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          data?: MarketReport[];
          error?: { message: string };
        };
        if (!res.ok)
          throw new Error(body.error?.message ?? `The queue could not be read (${res.status}).`);
        setRows(body.data ?? []);
        setFailure(null);
      })
      .catch((e: unknown) => {
        setRows([]);
        setFailure(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  function openDecision(id: string, action: string, label: string) {
    setPending({ id, action, label });
    setReasonCode('');
    setPrefill('');
    setNote('');
    setNoteError(undefined);
  }

  async function decide() {
    if (!pending) return;
    const { id, action } = pending;
    const written = note.trim();
    if (written.length < NOTE_MIN) {
      setNoteError(`Give a reason of at least ${NOTE_MIN} characters.`);
      return;
    }
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/market-reports/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          note: written,
          ...(reasonCode ? { reason_code: reasonCode } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message: string } };
        throw new Error(body.error?.message ?? `The decision was not recorded (${res.status}).`);
      }
      setPending(null);
      load();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (holds === null) return null;
  if (!isAdmin) return null;

  return (
    <section style={{ marginBlockStart: 'var(--s-6, 32px)' }}>
      <h2>Buying requests and services reported</h2>
      <p className="small muted">
        Reports from marketplace visitors about buying requests and service listings.
      </p>
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}
      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <Notice kind="info" title="No reports">
          <p className="small">No buying request or service has been reported.</p>
        </Notice>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
          {rows.map((r) => (
            <li
              key={r.id}
              style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}
            >
              <p>
                <strong>{TARGET_LABEL[r.target_type] ?? r.target_type}:</strong>{' '}
                <span dir="auto">{r.target_title ?? 'Removed'}</span>
                {r.poster_name ? (
                  <span className="small muted" dir="auto">
                    {' '}
                    · {r.poster_name}
                  </span>
                ) : null}
              </p>
              <p className="small">
                {reasonLabel(r.reason)} ·{' '}
                <Stamp kind={statusTone(r.status)}>{statusLabel(r.status)}</Stamp> · reported{' '}
                {formatDate(r.created_at)}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {r.target_type === 'profile' ? (
                  <a className="small" href={`/market/p/${r.target_id}`}>
                    View profile
                  </a>
                ) : null}
                {/* 2026-10-27: ask the poster to fix it; the post stays live. */}
                {(r.target_type === 'buying_request' || r.target_type === 'service_listing') &&
                r.target_title ? (
                  <RequestCorrectionButton
                    targetType={r.target_type}
                    targetId={r.target_id}
                    targetTitle={r.target_title}
                  />
                ) : null}
                {(ACTIONS[r.status] ?? [])
                  .filter((a) => r.target_type !== 'profile' || a.action !== 'remove_listing')
                  .map((a) => (
                    <Button
                      key={a.action}
                      size="small"
                      variant={a.action === 'remove_listing' ? 'danger' : 'secondary'}
                      disabled={busy === r.id}
                      onClick={() => openDecision(r.id, a.action, a.label)}
                    >
                      {a.label}
                    </Button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmationDialog
        open={pending !== null}
        onCancel={() => setPending(null)}
        onConfirm={() => void decide()}
        title={pending ? `${pending.label}: record this decision?` : 'Record this decision?'}
        consequence={
          pending?.action === 'remove_listing'
            ? 'The post leaves the market (it is not deleted) and the report is settled.'
            : 'The report moves on with this decision, and the reason is kept in the audit trail.'
        }
        confirmLabel={pending?.label ?? 'Confirm'}
        destructive={pending?.action === 'remove_listing'}
        busy={busy !== null}
      >
        <ReasonCodeSelect
          target={pending?.action === 'remove_listing' ? 'listing' : 'report'}
          value={reasonCode}
          onPick={(code, label) => {
            setReasonCode(code);
            const next = code ? `${label}: ` : '';
            // Replace only an empty reason or one this list wrote; never what was typed.
            if (note.trim() === '' || note === prefill) setNote(next);
            setPrefill(next);
          }}
        />
        <Field
          label="Reason"
          hint={`At least ${NOTE_MIN} characters, up to 500. Kept in the audit trail.`}
          error={noteError}
        >
          {(ids) => (
            <Textarea
              {...ids}
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      </ConfirmationDialog>
    </section>
  );
}
