'use client';

import { useState, type FormEvent } from 'react';

import { FARMER_PASSWORD_MIN } from '@agri-erp/shared';

import { Button, Card, Field, Notice, PasswordInput } from '../ui';

/**
 * SET A FARMER'S SIGN-IN PASSWORD (2026-10-08) -- the farmer's password reset
 * until SMS is live. Shown to an administrator, a supervisor and the farmer's
 * officer; POST /api/farmers/:id/sign-in decides who may, by scope. Also
 * creates the sign-in for a farmer an officer registered, who had none.
 */
export function FarmerSignInCard({ farmerId, phone }: { farmerId: string; phone: string }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'password_set' | 'account_created' | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(null);
    if (password.length < FARMER_PASSWORD_MIN) {
      setError(`Use at least ${FARMER_PASSWORD_MIN} characters.`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/farmers/${farmerId}/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { sign_in: 'password_set' | 'account_created' };
        error?: { message?: string; fields?: Record<string, string> };
      };
      if (!res.ok) {
        setError(
          body.error?.fields?.password ?? body.error?.message ?? 'The password was not set.',
        );
        return;
      }
      setDone(body.data?.sign_in ?? 'password_set');
      setPassword('');
    } catch {
      setError('The server could not be reached. Check the connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padded>
      <p className="label" style={{ marginBottom: 'var(--s-2)' }}>
        Sign-in
      </p>
      <p className="small muted" style={{ marginBottom: 'var(--s-3)' }}>
        The farmer signs in at <strong>/farmer/login</strong> with their phone ({phone}) and a
        password. If they forgot it, set a new one here and tell them. If they have no sign-in yet,
        this creates it.
      </p>
      {done ? (
        <Notice
          kind="success"
          title={done === 'account_created' ? 'Sign-in created' : 'Password changed'}
        >
          <p className="small">
            Tell the farmer the new password. They can change it themselves after signing in.
          </p>
        </Notice>
      ) : null}
      {error ? (
        <Notice kind="error" title="Not saved">
          <p className="small">{error}</p>
        </Notice>
      ) : null}
      <form
        onSubmit={(e) => void submit(e)}
        noValidate
        style={{ display: 'grid', gap: 'var(--s-3)' }}
      >
        <Field label="New password" hint={`At least ${FARMER_PASSWORD_MIN} characters.`}>
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
        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? 'Saving…' : 'Set sign-in password'}
        </Button>
      </form>
    </Card>
  );
}
