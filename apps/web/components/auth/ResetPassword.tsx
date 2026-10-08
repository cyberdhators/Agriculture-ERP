'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { passwordSchema } from '@agri-erp/shared';

import { supabaseBrowser } from '@/lib/supabase/browser';

import { Wordmark } from '../brand/Wordmark';
import { Button, Card, Field, Notice, PasswordInput } from '../ui';
import styles from './auth.module.css';

type Stage = 'checking' | 'ready' | 'invalid' | 'done';

/**
 * CHOOSE A NEW PASSWORD (2026-10-08) -- where the reset email's link lands.
 *
 * The link proves the person holds the mailbox. It arrives in one of three
 * shapes, depending on how the Supabase email template is written:
 *   - ?token_hash=...&type=recovery  (recommended: works on any device);
 *   - ?code=...                      (works only in the browser that asked);
 *   - #access_token=...              (older implicit links; the client reads it).
 * Whichever it is, it becomes a short recovery session, the new password is
 * set on it, and the person is signed out to sign in again with it.
 */
export function ResetPassword() {
  const [stage, setStage] = useState<Stage>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = supabaseBrowser();
    const url = new URL(window.location.href);
    const tokenHash = url.searchParams.get('token_hash');
    const code = url.searchParams.get('code');
    void (async () => {
      try {
        if (tokenHash) {
          const { error: e } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'recovery',
          });
          setStage(e ? 'invalid' : 'ready');
        } else if (code) {
          const { error: e } = await supabase.auth.exchangeCodeForSession(code);
          setStage(e ? 'invalid' : 'ready');
        } else {
          const { data } = await supabase.auth.getSession();
          setStage(data.session ? 'ready' : 'invalid');
        }
      } catch {
        setStage('invalid');
      }
      // The token must not linger in the address bar or the history.
      window.history.replaceState(null, '', '/reset-password');
    })();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = passwordSchema.safeParse(password);
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
      const supabase = supabaseBrowser();
      const { error: e } = await supabase.auth.updateUser({ password });
      if (e) {
        setError(
          e.status === 422
            ? 'Choose a password different from your old one.'
            : 'The password was not changed. Ask for a new link and try again.',
        );
        return;
      }
      await supabase.auth.signOut().catch(() => undefined);
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
        <h1 className={styles.title}>Choose a new password</h1>

        {stage === 'checking' ? <p className={styles.hint}>Checking your link…</p> : null}

        {stage === 'invalid' ? (
          <Notice kind="error" title="This link does not work">
            <p className="small">
              It may have expired or already been used.{' '}
              <a href="/forgot-password">Ask for a new link</a>.
            </p>
          </Notice>
        ) : null}

        {stage === 'done' ? (
          <Notice kind="success" title="Password changed">
            <p className="small">
              <a href="/login">Sign in</a> with your new password.
            </p>
          </Notice>
        ) : null}

        {stage === 'ready' ? (
          <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
            {error ? (
              <Notice kind="error" title="Not changed">
                <p className="small">{error}</p>
              </Notice>
            ) : null}
            <Field label="New password" hint="At least 12 characters.">
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
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save new password'}
            </Button>
          </form>
        ) : null}
      </Card>
    </main>
  );
}
