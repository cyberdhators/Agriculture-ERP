'use client';

import { totpCodeSchema } from '@agri-erp/shared';
import { useState, type FormEvent } from 'react';

import { Button, Field, Input, Notice } from '@/components/ui';
import { t, type Language } from '@/lib/i18n';
import { supabaseBrowser } from '@/lib/supabase/browser';

import styles from './auth.module.css';

/**
 * THE CODE STEP OF TWO-STEP SIGN-IN (2026-10-28). The password has been
 * accepted; the session is at the first level. The six-digit code is checked
 * by Supabase Auth against the account's verified authenticator, from the
 * browser, which raises the session to the second level (aal2) and rewrites
 * its cookie. requireRole refuses a staff session until this has happened.
 *
 * Nothing here decides access: it only lets the person finish signing in.
 */
export function MfaCodeStep({
  onVerified,
  intro,
  language = 'en',
}: {
  onVerified: () => void;
  intro: string;
  /** 2026-10-29: the email sign-in speaks Arabic too; staff screens stay English. */
  language?: Language;
}) {
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
        setError(t('mfa.notFound', language));
        return;
      }
      const verified = await auth.mfa.challengeAndVerify({ factorId: totp.id, code: parsed.data });
      if (verified.error) {
        setError(t('mfa.rejected', language));
        return;
      }
      onVerified();
    } catch {
      setError(t('email.login.unreachable', language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <p className={styles.hint}>{intro}</p>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Field label={t('mfa.label', language)}>
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
        {busy ? t('mfa.checking', language) : t('language.continue', language)}
      </Button>
    </form>
  );
}
