'use client';

import { useState, type FormEvent } from 'react';

import { Wordmark } from '../brand/Wordmark';
import { Button, Card, Field, Input, Notice, PasswordInput } from '../ui';
import styles from './auth.module.css';
import { RecoveryCodeShown } from './RecoveryCode';

/**
 * USE A RECOVERY CODE (2026-10-09) -- a farmer or buyer who forgot their
 * password sets a new one with the code they were given at registration. No
 * email, SMS or staff. On success they are shown their NEW code (the old one
 * no longer works) and sent to the right sign-in page.
 */
export function RecoverAccount() {
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ account: 'farmer' | 'buyer'; code: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFields({});
    if (password !== confirm) {
      setFields({ confirm: 'The two passwords are not the same.' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/account/recover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier, recovery_code: code, new_password: password }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { account: 'farmer' | 'buyer'; recovery_code: string };
        error?: { message?: string; fields?: Record<string, string> };
      };
      if (!res.ok || !body.data) {
        setFields(body.error?.fields ?? {});
        setError(body.error?.message ?? 'The password was not changed.');
        return;
      }
      setDone({ account: body.data.account, code: body.data.recovery_code });
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
          <h1 className={styles.title}>Use your recovery code</h1>
          <p className={styles.hint}>
            For farmers and buyers who forgot their password. You were given the code when you
            registered.
          </p>
        </div>

        {done ? (
          <>
            <Notice kind="success" title="Password changed">
              <p className="small">Your old recovery code no longer works. Here is your new one.</p>
            </Notice>
            <RecoveryCodeShown code={done.code} />
            <Button
              variant="primary"
              onClick={() =>
                window.location.assign(done.account === 'farmer' ? '/farmer/login' : '/login')
              }
            >
              I have written it down — sign in
            </Button>
          </>
        ) : (
          <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
            {error ? (
              <Notice kind="error" title="Not changed">
                <p className="small">{error}</p>
              </Notice>
            ) : null}
            <Field label="Phone number (farmers) or email (buyers)" error={fields.identifier}>
              {(ids) => (
                <Input
                  {...ids}
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Recovery code"
              hint="For example KX7P-29QD-M4HB"
              error={fields.recovery_code}
            >
              {(ids) => (
                <Input
                  {...ids}
                  className="mono"
                  autoComplete="off"
                  autoCapitalize="characters"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="New password"
              hint="Farmers: 6 or more characters. Buyers: 12 or more."
              error={fields.new_password}
            >
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
            <Field label="Type it again" error={fields.confirm}>
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
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !identifier || !code || !password}
            >
              {busy ? 'Checking…' : 'Set new password'}
            </Button>
          </form>
        )}

        <p className={styles.hint}>
          No code? Buyers can <a href="/forgot-password">reset by email</a>. Farmers: call CORWADO
          or your extension officer.
        </p>
      </Card>
    </main>
  );
}
