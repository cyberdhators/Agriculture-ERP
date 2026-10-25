'use client';

import { totpCodeSchema } from '@agri-erp/shared';
import { useState, type FormEvent } from 'react';

import { Button, Field, Input, Notice } from '@/components/ui';
import { supabaseBrowser } from '@/lib/supabase/browser';

/**
 * THE CODE STEP OF TWO-STEP SIGN-IN (2026-10-28). The password has been
 * accepted; the session is at the first level. The six-digit code is checked
 * by Supabase Auth against the account's verified authenticator, from the
 * browser, which raises the session to the second level (aal2) and rewrites
 * its cookie. requireRole refuses a staff session until this has happened.
 *
 * Nothing here decides access: it only lets the person finish signing in.
 */
export function MfaCodeStep({ onVerified, intro }: { onVerified: () => void; intro: string }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = totpCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const auth = supabaseBrowser().auth;
      const factors = await auth.mfa.listFactors();
      const totp = factors.data?.totp.find((f: { status: string }) => f.status === 'verified');
      if (factors.error || !totp) {
        setError('Your authenticator could not be found. Sign in again, or ask a Super Admin.');
        return;
      }
      const verified = await auth.mfa.challengeAndVerify({ factorId: totp.id, code: parsed.data });
      if (verified.error) {
        setError('That code was not accepted. Codes change every 30 seconds: try the new one.');
        return;
      }
      onVerified();
    } catch {
      setError('The sign-in service could not be reached. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate style={{ display: 'grid', gap: 'var(--s-3)' }}>
      <p className="small">{intro}</p>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Field label="Six-digit code">
        {(ids) => (
          <Input
            {...ids}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            disabled={busy}
          />
        )}
      </Field>
      <Button type="submit" variant="primary" disabled={busy || code.length !== 6}>
        {busy ? 'Checking…' : 'Continue'}
      </Button>
    </form>
  );
}
