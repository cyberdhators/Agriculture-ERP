'use client';

import { useCallback, useEffect, useState } from 'react';

import type { AccountStanding, SanctionKind } from '@agri-erp/shared';

import { formatDate } from '@/lib/format';

import { ProfileModeration } from './ProfileModeration';
import { ReasonCodeSelect, useReasonCodes } from './ReasonCodeSelect';
import { Button, Card, Field, Notice, Stamp, Textarea } from '../ui';
import { ConfirmationDialog } from '../ui/feedback';

/**
 * SUSPEND OR RESTORE AN ACCOUNT (2026-10-21). The box on a farmer's record and
 * the button on a buyer's row. Administrators holding "Moderate content and
 * listings"; the standing route answers 403 to anyone else, and then nothing
 * is shown. Every decision carries a reason, which the audit trail keeps.
 *
 * Compact is the table form: the button and its warnings only, because the
 * row shows its own "Suspended" stamp.
 */

const REASON_MIN = 5;

const CONSEQUENCE = {
  suspend:
    'The account cannot sign in or use the app from its next request, and everything it posted leaves the market. It stays on the register, and nothing is deleted.',
  restore:
    'The account can sign in and use the app again, and its posts return to the market as they were.',
};

interface Failure {
  status: number;
  message: string;
  fields: Record<string, string>;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw {
      status: 0,
      message: 'The server could not be reached. Check the connection.',
      fields: {},
    };
  }
  const body = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string; fields?: Record<string, string> };
  };
  if (!res.ok || body.data === undefined) {
    throw {
      status: res.status,
      message: body.error?.message ?? `The request failed (${res.status}).`,
      fields: body.error?.fields ?? {},
    } satisfies Failure;
  }
  return body.data;
}

export function AccountSanction({
  kind,
  id,
  compact = false,
  onChange,
}: {
  kind: SanctionKind;
  id: string;
  compact?: boolean;
  /**
   * Told after a suspension or restoration is saved, so a list can reload and
   * say so itself: reloading a table unmounts this box and its warning.
   */
  onChange?: (done: { action: 'suspend' | 'restore'; signInReached: boolean }) => void;
}) {
  const [standing, setStanding] = useState<AccountStanding | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  // 2026-10-25: the reason code chosen from Settings' list, and the text it
  // pre-filled, so choosing another code replaces only an untouched pre-fill.
  const [reasonCode, setReasonCode] = useState('');
  const [prefill, setPrefill] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [signInMissed, setSignInMissed] = useState<'suspend' | 'restore' | null>(null);
  const [smsMissed, setSmsMissed] = useState(false);
  // 2026-10-26 (acceptance test): read when the box mounts, so the dialog
  // shows the codes at once; Suspend stays disabled until they have loaded.
  const { loading: codesLoading } = useReasonCodes('account');

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setStanding(
        await call<AccountStanding>(
          `/api/admin/accounts/standing?kind=${kind}&id=${encodeURIComponent(id)}`,
        ),
      );
    } catch (e) {
      const f = e as Failure;
      if (f.status === 403) setHidden(true);
      else setLoadError(f.message);
    }
  }, [kind, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (hidden) return null;

  const action = standing?.suspended ? 'restore' : 'suspend';

  const decide = async () => {
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN) {
      setFailure({
        status: 400,
        message: 'Check the reason.',
        fields: { reason: `Give a reason of at least ${REASON_MIN} characters.` },
      });
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const answer = await call<
        AccountStanding & {
          sign_in_blocked?: boolean;
          sign_in_restored?: boolean;
          sessions_ended?: boolean;
          notice_sms?: 'sent' | 'failed' | 'no_mobile';
        }
      >(`/api/admin/accounts/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          id,
          reason: trimmed,
          ...(reasonCode ? { reason_code: reasonCode } : {}),
        }),
      });
      // The record changed either way; only the sign-in service may have missed it.
      const signInReached =
        answer.sign_in_blocked !== false &&
        answer.sign_in_restored !== false &&
        answer.sessions_ended !== false;
      setSignInMissed(signInReached ? null : action);
      setSmsMissed(answer.notice_sms === 'failed');
      setOpen(false);
      setReason('');
      setReasonCode('');
      setPrefill('');
      onChange?.({ action, signInReached });
      await load();
    } catch (e) {
      setFailure(e as Failure);
    } finally {
      setBusy(false);
    }
  };

  const button = standing ? (
    <Button
      size={compact ? 'small' : 'default'}
      variant={action === 'suspend' ? 'danger' : 'secondary'}
      onClick={() => {
        setReason('');
        setReasonCode('');
        setPrefill('');
        setFailure(null);
        setOpen(true);
      }}
    >
      {action === 'suspend' ? 'Suspend account' : 'Restore account'}
    </Button>
  ) : null;

  const warnings = (
    <>
      {loadError ? (
        <Notice kind="error" title="Account standing could not be loaded">
          <p className="small">{loadError}</p>
          <Button size="small" variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        </Notice>
      ) : null}
      {smsMissed ? (
        <Notice kind="warn" title="Text message not sent">
          <p className="small">
            The account was suspended, but the text message telling them so could not be sent.
            Tell them another way if you can.
          </p>
        </Notice>
      ) : null}
      {signInMissed ? (
        <Notice kind="warn" title="Sign-in not updated">
          <p className="small">
            The account was {signInMissed === 'suspend' ? 'suspended' : 'restored'}, but the change
            did not reach the sign-in service. Try again in a moment.
          </p>
        </Notice>
      ) : null}
    </>
  );

  const dialog = (
    <ConfirmationDialog
      open={open}
      onCancel={() => setOpen(false)}
      onConfirm={() => void decide()}
      title={action === 'suspend' ? 'Suspend this account?' : 'Restore this account?'}
      consequence={CONSEQUENCE[action]}
      confirmLabel={action === 'suspend' ? 'Suspend account' : 'Restore account'}
      destructive={action === 'suspend'}
      busy={busy}
      confirmDisabled={action === 'suspend' && codesLoading}
    >
      {failure && !failure.fields.reason ? <Notice kind="error">{failure.message}</Notice> : null}
      {action === 'suspend' ? (
        <ReasonCodeSelect
          target="account"
          value={reasonCode}
          onPick={(code, label) => {
            setReasonCode(code);
            const next = code ? `${label}: ` : '';
            // Replace only an empty reason or one this list wrote; never what was typed.
            if (reason.trim() === '' || reason === prefill) setReason(next);
            setPrefill(next);
          }}
        />
      ) : null}
      <Field
        label="Reason"
        hint={`At least ${REASON_MIN} characters, up to 500. Kept in the audit trail.`}
        error={failure?.fields.reason}
      >
        {(ids) => (
          <Textarea
            {...ids}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
    </ConfirmationDialog>
  );

  if (compact) {
    return (
      <div style={{ display: 'grid', gap: 'var(--s-2)', justifyItems: 'start' }}>
        {button}
        {warnings}
        {dialog}
        {/* 2026-10-23: the public profile's photo, removable by moderators. */}
        <ProfileModeration kind={kind} id={id} compact />
      </div>
    );
  }

  return (
    <Card padded>
      <p className="label" style={{ marginBottom: 'var(--s-3)' }}>
        Account
      </p>
      {standing?.suspended ? (
        <div style={{ marginBottom: 'var(--s-3)' }}>
          <Stamp kind="rejected">Suspended</Stamp>
          <p className="small" style={{ marginTop: 'var(--s-2)' }}>
            {standing.suspended_at ? `Since ${formatDate(standing.suspended_at)}. ` : ''}
            {standing.reason ? <span dir="auto">{standing.reason}</span> : null}
          </p>
        </div>
      ) : standing ? (
        <p className="small muted" style={{ marginBottom: 'var(--s-3)' }}>
          {standing.has_sign_in
            ? 'Suspending stops sign-in and takes this account’s posts off the market.'
            : 'This account has no sign-in. Suspending still takes its posts off the market.'}
        </p>
      ) : null}
      <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
        {button}
        {warnings}
      </div>
      {dialog}
      {/* 2026-10-23: the public profile -- status, photo, Remove photo. */}
      <div style={{ marginTop: 'var(--s-4)' }}>
        <ProfileModeration kind={kind} id={id} />
      </div>
    </Card>
  );
}
