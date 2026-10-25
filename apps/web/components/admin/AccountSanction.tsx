'use client';

import { useCallback, useEffect, useState } from 'react';

import type { AccountStanding, SanctionKind } from '@agri-erp/shared';

import { formatDate } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings/client';

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
 *
 * 2026-10-28: DISABLE beside Suspend -- permanent until a Super Admin
 * re-enables it with a reason (the routes enforce it; `canReenable` only
 * decides whether the button is offered). A disabled account shows
 * "Disabled", and Restore is not offered for it.
 */

type SanctionAction = 'suspend' | 'restore' | 'disable' | 'reenable';

const LABEL: Record<SanctionAction, string> = {
  suspend: 'Suspend account',
  restore: 'Restore account',
  disable: 'Disable account',
  reenable: 'Re-enable account',
};

const TITLE: Record<SanctionAction, string> = {
  suspend: 'Suspend this account?',
  restore: 'Restore this account?',
  disable: 'Disable this account permanently?',
  reenable: 'Re-enable this disabled account?',
};

const REASON_MIN = 5;

const CONSEQUENCE = {
  suspend:
    'The account cannot sign in or use the app from its next request, and everything it posted leaves the market. It stays on the register, and nothing is deleted.',
  restore:
    'The account can sign in and use the app again, and its posts return to the market as they were.',
  disable:
    'Every session ends, the account cannot sign in, and everything it posted leaves the market. Unlike a suspension, only a Super Admin can undo this, with a reason. Nothing is deleted.',
  reenable:
    'The disable and the suspension beneath it are lifted. The account can sign in again and its posts return to the market as they were.',
} satisfies Record<SanctionAction, string>;

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

/** 2026-10-28: the account's advisory authorization, in words. */
const ADVISORY_WORDS: Record<string, string> = {
  profile: 'Advice profile, not applied for approval',
  submitted: 'Applied for approval; waiting for review',
  clarification_requested: 'Applied; CORWADO asked a question',
  approved: 'Approved adviser',
  suspended: 'Approved adviser, suspended',
  declined: 'Application declined',
  revoked: 'Approval revoked',
  withdrawn: 'Application withdrawn',
};

export function AccountSanction({
  kind,
  id,
  compact = false,
  canReenable = false,
  onChange,
}: {
  kind: SanctionKind;
  id: string;
  compact?: boolean;
  /** 2026-10-28: the caller is a Super Admin, so Re-enable is offered on a disabled account. */
  canReenable?: boolean;
  /**
   * Told after a suspension or restoration is saved, so a list can reload and
   * say so itself: reloading a table unmounts this box and its warning.
   */
  onChange?: (done: { action: SanctionAction; signInReached: boolean }) => void;
}) {
  const [standing, setStanding] = useState<AccountStanding | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  // 2026-10-27 (settings phase 2): the review period and appeal window.
  const publicSettings = usePublicSettings();
  // 2026-10-25: the reason code chosen from Settings' list, and the text it
  // pre-filled, so choosing another code replaces only an untouched pre-fill.
  const [reasonCode, setReasonCode] = useState('');
  const [prefill, setPrefill] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [signInMissed, setSignInMissed] = useState<SanctionAction | null>(null);
  const [action, setAction] = useState<SanctionAction>('suspend');
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

  // What the account can have done to it now, in the order the buttons show.
  const offered: SanctionAction[] = !standing
    ? []
    : standing.disabled
      ? canReenable
        ? ['reenable']
        : []
      : standing.suspended
        ? ['restore', 'disable']
        : ['suspend', 'disable'];
  const asksForCode = action === 'suspend' || action === 'disable';

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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-2)' }}>
      {offered.map((a) => (
        <Button
          key={a}
          size={compact ? 'small' : 'default'}
          variant={a === 'suspend' || a === 'disable' ? 'danger' : 'secondary'}
          onClick={() => {
            setAction(a);
            setReason('');
            setReasonCode('');
            setPrefill('');
            setFailure(null);
            setOpen(true);
          }}
        >
          {LABEL[a]}
        </Button>
      ))}
      {standing.disabled && !canReenable ? (
        <p className="small muted">Disabled. Only a Super Admin can re-enable this account.</p>
      ) : null}
    </div>
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
            The account was {action === 'disable' ? 'disabled' : 'suspended'}, but the text message
            telling them so could not be sent. Tell them another way if you can.
          </p>
        </Notice>
      ) : null}
      {signInMissed ? (
        <Notice kind="warn" title="Sign-in not updated">
          <p className="small">
            The account was{' '}
            {signInMissed === 'suspend'
              ? 'suspended'
              : signInMissed === 'disable'
                ? 'disabled'
                : signInMissed === 'reenable'
                  ? 're-enabled'
                  : 'restored'}
            , but the change did not reach the sign-in service. Try again in a moment.
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
      title={TITLE[action]}
      consequence={CONSEQUENCE[action]}
      confirmLabel={LABEL[action]}
      destructive={asksForCode}
      busy={busy}
      confirmDisabled={asksForCode && codesLoading}
    >
      {failure && !failure.fields.reason ? <Notice kind="error">{failure.message}</Notice> : null}
      {action === 'suspend' ? (
        <p className="small muted">
          The account stays suspended until it is restored. Review it within{' '}
          {publicSettings?.suspension_review_days ?? 30} days; an appeal is accepted for{' '}
          {publicSettings?.appeal_window_days ?? 30} days (Settings, Notifications and moderation).
        </p>
      ) : null}
      {asksForCode ? (
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
      {standing?.disabled ? (
        <div style={{ marginBottom: 'var(--s-3)' }}>
          <Stamp kind="rejected">Disabled</Stamp>
          <p className="small" style={{ marginTop: 'var(--s-2)' }}>
            {standing.disabled_at ? `Since ${formatDate(standing.disabled_at)}. ` : ''}
            {standing.disabled_reason ? <span dir="auto">{standing.disabled_reason}</span> : null}
          </p>
        </div>
      ) : standing?.suspended ? (
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
      {/* 2026-10-28: advisory authorization, separate from account standing. */}
      {standing?.advisory && standing.advisory.status !== 'none' ? (
        <div style={{ marginTop: 'var(--s-4)' }}>
          <p className="label" style={{ marginBottom: 'var(--s-2)' }}>
            Advisory authorization
          </p>
          <p className="small">
            {ADVISORY_WORDS[standing.advisory.status] ?? standing.advisory.status}
            {standing.advisory.status === 'suspended' && standing.advisory.suspended_until
              ? ` until ${formatDate(standing.advisory.suspended_until)}`
              : ''}
            . <a href="/admin/advisers">Review in Advisers</a>
          </p>
          <p className="small muted">
            Decided separately: suspending or restoring the account does not change it.
          </p>
        </div>
      ) : null}
      {/* 2026-10-23: the public profile -- status, photo, Remove photo. */}
      <div style={{ marginTop: 'var(--s-4)' }}>
        <ProfileModeration kind={kind} id={id} />
      </div>
    </Card>
  );
}
