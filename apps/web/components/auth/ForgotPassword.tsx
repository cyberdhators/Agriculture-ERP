'use client';

import { useState, type FormEvent } from 'react';

import { supabaseBrowser } from '@/lib/supabase/browser';

import { Wordmark } from '../brand/Wordmark';
import { Button, Card, Field, Input, Notice } from '../ui';
import styles from './auth.module.css';

/**
 * FORGOT PASSWORD (2026-10-08) -- for anyone who signs in with an email
 * address: buyers, and office staff. Supabase sends a reset link to that
 * address; the link opens /reset-password.
 *
 * The answer is the same whether or not the address has an account, so the
 * page cannot be used to find out who is registered. Farmers and officers sign
 * in with a phone number and have no email: their password is set by staff.
 */
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Enter the email address you registered with.');
      return;
    }
    setBusy(true);
    try {
      const { error: failure } = await supabaseBrowser().auth.resetPasswordForEmail(address, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      // A rate limit is the only refusal worth telling the person about; any
      // other answer is shown as "sent", so nobody learns who has an account.
      if (failure && failure.status === 429) {
        setError('Too many requests. Wait a few minutes, then try again.');
        return;
      }
      setSent(true);
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
          <h1 className={styles.title}>Forgot your password?</h1>
          <p className={styles.hint}>
            Enter the email address you sign in with. We will send you a link to choose a new
            password.
          </p>
        </div>

        {sent ? (
          <Notice kind="success" title="Check your email">
            <p className="small">
              If an account uses that address, a reset link is on its way. It can take a few
              minutes; check your spam folder too. The link works once.
            </p>
          </Notice>
        ) : (
          <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
            {error ? (
              <Notice kind="error" title="Not sent">
                <p className="small">{error}</p>
              </Notice>
            ) : null}
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
              {busy ? 'Sending…' : 'Send reset link'}
            </Button>
          </form>
        )}

        <p className={styles.hint}>
          Farmers: your password is reset by your extension officer or CORWADO -- call them.{' '}
          <a href="/login">Back to sign in</a>
        </p>
      </Card>
    </main>
  );
}
