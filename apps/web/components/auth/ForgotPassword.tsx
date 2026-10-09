'use client';

import { useState, type FormEvent } from 'react';

import { passwordSchema } from '@agri-erp/shared';

import { supabaseBrowser } from '@/lib/supabase/browser';

import { Wordmark } from '../brand/Wordmark';
import { Button, Card, Field, Input, Notice, PasswordInput } from '../ui';
import styles from './auth.module.css';

type Stage = 'email' | 'code' | 'done';

const linkButton = {
  background: 'none',
  border: 0,
  padding: 0,
  color: 'inherit',
  textDecoration: 'underline',
  cursor: 'pointer',
} as const;

/**
 * FORGOT PASSWORD -- BY EMAILED CODE (2026-10-09). For anyone who signs in with
 * an email address: buyers, and office staff.
 *
 *   1. The person enters their email; Supabase emails a short one-time code
 *      (the Reset Password email template shows {{ .Token }}).
 *   2. On this same page they enter the code and a new password. The code is
 *      checked (verifyOtp, type 'recovery'), the password is set, and they are
 *      signed out to sign in with it.
 *
 * Chosen over a link (the owner, 2026-10-09): no redirect addresses to
 * configure, works when the email is read on another device, and an email
 * security scanner cannot use the code up by "clicking" it.
 *
 * Step 1 answers the same whether or not the address has an account, so the
 * page cannot be used to find out who is registered. Farmers and officers sign
 * in with a phone number; their password is set by staff.
 */
export function ForgotPassword() {
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Enter the email address you registered with.');
      return;
    }
    setBusy(true);
    try {
      const { error: failure } = await supabaseBrowser().auth.resetPasswordForEmail(address);
      // A rate limit is the only refusal worth telling the person about; any
      // other answer moves on, so nobody learns who has an account.
      if (failure && failure.status === 429) {
        setError('Too many requests. Wait a minute, then try again.');
        return;
      }
      setStage('code');
    } catch {
      setError('The server could not be reached. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function saveWithCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const token = code.replace(/\D/g, '');
    if (token.length < 6) {
      setError('Enter the code from the email.');
      return;
    }
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
      const { error: wrong } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token,
        type: 'recovery',
      });
      if (wrong) {
        setError(
          wrong.status === 429
            ? 'Too many tries. Wait a few minutes, then ask for a new code.'
            : 'That code is wrong or has expired. Check the email, or ask for a new code.',
        );
        return;
      }
      const { error: notSet } = await supabase.auth.updateUser({ password });
      if (notSet) {
        setError(
          notSet.status === 422
            ? 'Choose a password different from your old one.'
            : 'The password was not changed. Ask for a new code and try again.',
        );
        return;
      }
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
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
        <div>
          <h1 className={styles.title}>
            {stage === 'done' ? 'Password changed' : 'Forgot your password?'}
          </h1>
          {stage === 'email' ? (
            <p className={styles.hint}>
              Enter the email address you sign in with. We will email you a code to set a new
              password.
            </p>
          ) : null}
          {stage === 'code' ? (
            <p className={styles.hint}>
              If an account uses <strong>{email.trim()}</strong>, we have emailed it a code. It can
              take a few minutes; check your spam folder too. The code works once and expires in an
              hour.
            </p>
          ) : null}
        </div>

        {error ? (
          <Notice kind="error" title="Not done">
            <p className="small">{error}</p>
          </Notice>
        ) : null}

        {stage === 'email' ? (
          <form className={styles.form} onSubmit={(e) => void sendCode(e)} noValidate>
            <Field label="Email address">
              {(ids) => (
                <Input
                  {...ids}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
              )}
            </Field>
            <Button type="submit" variant="primary" disabled={busy || !email}>
              {busy ? 'Sending…' : 'Send code'}
            </Button>
          </form>
        ) : null}

        {stage === 'code' ? (
          <form className={styles.form} onSubmit={(e) => void saveWithCode(e)} noValidate>
            <Field label="Code from the email" hint="Numbers only, for example 483921">
              {(ids) => (
                <Input
                  {...ids}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="mono"
                  maxLength={12}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </Field>
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
            <p className={styles.hint}>
              No code?{' '}
              <button
                type="button"
                style={linkButton}
                onClick={() => void sendCode()}
                disabled={busy}
              >
                Send it again
              </button>{' '}
              or{' '}
              <button
                type="button"
                style={linkButton}
                onClick={() => {
                  setStage('email');
                  setCode('');
                  setError(null);
                }}
              >
                use a different email
              </button>
              .
            </p>
          </form>
        ) : null}

        {stage === 'done' ? (
          <Notice kind="success" title="You can sign in now">
            <p className="small">
              <a href="/login">Sign in</a> with your email and your new password.
            </p>
          </Notice>
        ) : null}

        <p className={styles.hint}>
          Farmers: your password is reset by your extension officer or CORWADO -- call them.{' '}
          <a href="/login">Back to sign in</a>
        </p>
      </Card>
    </main>
  );
}
