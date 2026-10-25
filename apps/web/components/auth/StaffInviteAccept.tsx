'use client';

import { useEffect, useState, type FormEvent } from 'react';

import {
  type StaffInvitationPreview,
  acceptStaffInvitationSchema,
  staffInvitationTokenSchema,
} from '@agri-erp/shared';

import { Wordmark } from '../brand/Wordmark';
import { Button, Card, Field, Notice, PasswordInput } from '../ui';
import styles from './auth.module.css';

type Stage = 'checking' | 'ready' | 'invalid' | 'used' | 'done';

const ROLE_WORDS = {
  admin: 'an administrator',
  supervisor: 'a supervisor',
  read_only: 'a read-only member of staff',
} as const;

/**
 * JOIN AGRIONE STAFF (2026-10-28, lane-security) -- where the invitation
 * email's link lands. The token is after `#`, so it never reaches a server in
 * an address; it is read here, removed from the address bar, and sent in the
 * body of two calls: preview (who is invited, as what) and accept (with the
 * password the invitee chooses). Nobody else ever knows that password.
 */
export function StaffInviteAccept() {
  const [stage, setStage] = useState<Stage>('checking');
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState<StaffInvitationPreview | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, '');
    window.history.replaceState(null, '', '/staff-invite');
    const parsed = staffInvitationTokenSchema.safeParse(raw);
    if (!parsed.success) {
      setStage('invalid');
      return;
    }
    setToken(parsed.data);
    void (async () => {
      try {
        const res = await fetch('/api/staff-invitations/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: parsed.data }),
        });
        if (!res.ok) {
          setStage('invalid');
          return;
        }
        const body = (await res.json()) as { data?: StaffInvitationPreview };
        if (!body.data) {
          setStage('invalid');
          return;
        }
        setPreview(body.data);
        setStage(body.data.status === 'pending' ? 'ready' : 'used');
      } catch {
        setStage('invalid');
      }
    })();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = acceptStaffInvitationSchema.safeParse({ token, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Choose a longer password.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords are not the same.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/staff-invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setError(body.error?.message ?? 'The account could not be created. Try again in a moment.');
        return;
      }
      setStage('done');
    } catch {
      setError('The server could not be reached. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.wrap}>
      <Card padded className={styles.card}>
        <div className={styles.brand}>
          <Wordmark size={28} tagline />
        </div>
        <h1 className={styles.title}>Join AgriOne staff</h1>

        {stage === 'checking' ? <p className={styles.hint}>Checking your invitation…</p> : null}

        {stage === 'invalid' ? (
          <Notice kind="error" title="This link does not work">
            <p className="small">
              Open the link from the invitation email again, exactly as it was sent. If it still
              does not work, ask the person who invited you for a new invitation.
            </p>
          </Notice>
        ) : null}

        {stage === 'used' && preview ? (
          <Notice kind="warn" title="This invitation cannot be used">
            <p className="small">
              {preview.status === 'accepted'
                ? 'It has already been used. Sign in with the password you chose.'
                : preview.status === 'expired'
                  ? 'It has expired. Ask the person who invited you for a new one.'
                  : 'It was withdrawn. Ask CORWADO if you think this is a mistake.'}
            </p>
            {preview.status === 'accepted' ? (
              <p className="small">
                <a href="/admin/login">Staff sign in</a>
              </p>
            ) : null}
          </Notice>
        ) : null}

        {stage === 'done' ? (
          <Notice kind="success" title="Your account is ready">
            <p className="small">
              <a href="/admin/login">Sign in</a> with {preview?.email_hint ?? 'your email'} and the
              password you chose.
              {preview?.role === 'admin'
                ? ' You will be asked to set up two-step sign-in with an authenticator app.'
                : ''}
            </p>
          </Notice>
        ) : null}

        {stage === 'ready' && preview ? (
          <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
            <p className={styles.hint}>
              {preview.name}, you are invited to join as {ROLE_WORDS[preview.role]}. Your sign-in
              is {preview.email_hint}. Choose a password only you know.
            </p>
            {error ? (
              <Notice kind="error" title="Not created">
                <p className="small">{error}</p>
              </Notice>
            ) : null}
            <Field label="Password" hint="At least 12 characters.">
              {(ids) => (
                <PasswordInput
                  {...ids}
                  autoComplete="new-password"
                  value={password}
                  showLabel="Show"
                  hideLabel="Hide"
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            <Field label="Type it again">
              {(ids) => (
                <PasswordInput
                  {...ids}
                  autoComplete="new-password"
                  value={confirm}
                  showLabel="Show"
                  hideLabel="Hide"
                  onChange={(e) => setConfirm(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" variant="primary" disabled={busy || !password || !confirm}>
              {busy ? 'Creating your account…' : 'Create my account'}
            </Button>
          </form>
        ) : null}
      </Card>
    </main>
  );
}
