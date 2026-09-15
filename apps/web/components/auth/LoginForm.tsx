'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Wordmark } from '@/components/brand/Wordmark';
import { Button, Card, Field, Input, Notice } from '@/components/ui';
import { loginIdentifier } from '@/lib/auth/identifier';
import { supabaseBrowser } from '@/lib/supabase/browser';

import styles from './auth.module.css';

/**
 * Staff sign-in. Email — or, for an extension officer, a phone number, from
 * which the account identifier is derived (lib/auth/identifier.ts) — and
 * password go to Supabase Auth; on success the session cookie is set in the
 * browser and the routes' requireRole reads it from then on. The error never
 * says which of the two was wrong.
 */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const { error: signInError } = await supabaseBrowser().auth.signInWithPassword({
        email: loginIdentifier(login),
        password,
      });
      if (signInError) {
        setError(
          signInError.status === 400
            ? 'That email or phone number and password do not match.'
            : 'The sign-in service could not be reached. Try again in a moment.',
        );
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError('Sign-in is not available on this deployment. Tell an administrator.');
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
          <h1 className={styles.title}>Sign in</h1>
          <p className={styles.hint}>
            Staff sign in with the email on their account. Extension officers sign in with their
            phone number. Accounts are issued by an administrator.
          </p>
        </div>

        {error ? (
          <Notice kind="error" title="Not signed in">
            <p className="small">{error}</p>
          </Notice>
        ) : null}

        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <Field label="Email or phone number">
            {(ids) => (
              <Input
                {...ids}
                type="text"
                autoComplete="username"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                disabled={busy}
                required
              />
            )}
          </Field>
          <Field label="Password">
            {(ids) => (
              <Input
                {...ids}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                required
              />
            )}
          </Field>
          <Button type="submit" variant="primary" disabled={busy || !login || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
