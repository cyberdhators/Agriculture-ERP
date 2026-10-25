'use client';

import Link from 'next/link';
import { useState } from 'react';

import { parseSouthSudanMobile, type RecoveryCodeSent } from '@agri-erp/shared';

import { Button, Field, Input, Notice, PasswordInput, PrefixedInput } from '@/components/ui';
import { validatePassword } from '@/lib/farmers/schema';
import { FarmerApiError, farmerApi, useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';

import { ResendCode, useResendWait } from './ChangePhone';
import styles from './farmer.module.css';

type Stage = 'phone' | 'code' | 'password' | 'done' | 'unavailable';

/**
 * FORGOT YOUR PASSWORD? -- FOR A PHONE ACCOUNT (2026-10-27, CORWADO's
 * specification: "Provide resend, change-number and secure recovery
 * functions"; "ordinary participation must not depend on project staff").
 *
 *   1. The number (POST /api/auth/recovery/code). The answer is the same for
 *      every number, so this page says "if this number has an account".
 *   2. The code from the SMS (POST /api/auth/recovery/verify), with resend
 *      after 60 seconds.
 *   3. A new password (POST /api/auth/recovery/reset). Every other session of
 *      the account is ended; the person then signs in.
 *
 * When this deployment sends no codes, the page says to ask an extension
 * officer or CORWADO, who can still set a password on the farmer's record.
 */
export function FarmerForgotPassword() {
  const { language } = useFarmerSession();
  const [stage, setStage] = useState<Stage>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [sent, setSent] = useState<{ id: string; phone: string; at: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wait = useResendWait(sent?.at ?? null);

  const show = t('login.show', language);
  const hide = t('login.hide', language);

  const message = (error: unknown) =>
    error instanceof FarmerApiError ? error.message : t('recover.failed', language);

  async function ask(value: string) {
    const answer = await farmerApi<RecoveryCodeSent>('/api/auth/recovery/code', {
      method: 'POST',
      body: JSON.stringify({ phone: value }),
      headers: { 'accept-language': language === 'ar' ? 'ar' : 'en' },
    });
    if (!answer.available || !answer.verification_id) {
      setStage('unavailable');
      return;
    }
    setSent({ id: answer.verification_id, phone: value, at: new Date().toISOString() });
    setCode('');
    setStage('code');
  }

  async function submitPhone(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseSouthSudanMobile(phone);
    if (!parsed.ok) {
      setErrors({ phone: parsed.message });
      return;
    }
    setErrors({});
    setFailure(null);
    setBusy(true);
    try {
      await ask(parsed.value);
    } catch (error) {
      if (error instanceof FarmerApiError && error.fields.phone) {
        setErrors({ phone: error.fields.phone });
      } else setFailure(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!sent) return;
    setBusy(true);
    setFailure(null);
    try {
      await ask(sent.phone);
    } catch (error) {
      setFailure(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    if (!sent) return;
    setBusy(true);
    setErrors({});
    setFailure(null);
    try {
      await farmerApi('/api/auth/recovery/verify', {
        method: 'POST',
        body: JSON.stringify({ verification_id: sent.id, code: code.trim() }),
      });
      setStage('password');
    } catch (error) {
      setErrors({
        code:
          error instanceof FarmerApiError
            ? (error.fields.code ?? error.message)
            : t('recover.failed', language),
      });
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!sent) return;
    if (validatePassword(password)) {
      setErrors({ password: t('register.passwordHint', language) });
      return;
    }
    if (again !== password) {
      setErrors({ again: t('register.passwordMismatch', language) });
      return;
    }
    setErrors({});
    setFailure(null);
    setBusy(true);
    try {
      await farmerApi('/api/auth/recovery/reset', {
        method: 'POST',
        body: JSON.stringify({ verification_id: sent.id, password }),
      });
      setPassword('');
      setAgain('');
      setStage('done');
    } catch (error) {
      if (error instanceof FarmerApiError && error.fields.password) {
        setErrors({ password: error.fields.password });
      } else setFailure(message(error));
    } finally {
      setBusy(false);
    }
  }

  const startOver = () => {
    setStage('phone');
    setSent(null);
    setCode('');
    setErrors({});
    setFailure(null);
  };

  return (
    <div className={styles.sheet}>
      <p className={styles.eyebrow}>{t('brand.tagline', language)}</p>
      <h1 className={styles.h1}>
        {stage === 'done' ? t('recover.doneTitle', language) : t('recover.title', language)}
      </h1>

      {failure ? (
        <Notice kind="error">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}

      {stage === 'phone' ? (
        <form onSubmit={submitPhone} noValidate>
          <p className="small muted">{t('recover.lead', language)}</p>
          <div className={styles.stack} style={{ marginBlockStart: 'var(--s-4)' }}>
            <Field
              label={t('login.phoneLabel', language)}
              hint={t('login.phoneHint', language)}
              error={errors.phone}
            >
              {(ids) => (
                <PrefixedInput
                  {...ids}
                  prefix="+211"
                  inputMode="tel"
                  autoComplete="tel-national"
                  className="mono"
                  placeholder="9XX XXX XXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              )}
            </Field>
          </div>
          <div className={styles.actions}>
            <Button
              type="submit"
              variant="primary"
              className={styles.blockButton}
              disabled={busy}
            >
              {busy ? t('recover.sending', language) : t('recover.send', language)}
            </Button>
          </div>
        </form>
      ) : null}

      {stage === 'code' ? (
        <form onSubmit={submitCode} noValidate>
          <p className="small">{t('recover.sentLead', language)}</p>
          <div className={styles.stack} style={{ marginBlockStart: 'var(--s-4)' }}>
            <Field
              label={t('recover.codeLabel', language)}
              hint={t('recover.codeHint', language)}
              error={errors.code}
            >
              {(ids) => (
                <Input
                  {...ids}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="mono"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </Field>
          </div>
          <div className={styles.actions}>
            <Button
              type="submit"
              variant="primary"
              className={styles.blockButton}
              disabled={busy || code.trim().length !== 6}
            >
              {t('recover.verify', language)}
            </Button>
          </div>
          <ResendCode
            language={language}
            wait={wait}
            busy={busy}
            onResend={() => void resend()}
          />
          <Button variant="ghost" onClick={startOver} disabled={busy}>
            {t('recover.otherNumber', language)}
          </Button>
        </form>
      ) : null}

      {stage === 'password' ? (
        <form onSubmit={submitPassword} noValidate>
          <div className={styles.stack} style={{ marginBlockStart: 'var(--s-4)' }}>
            <Field
              label={t('recover.newPassword', language)}
              hint={t('register.passwordHint', language)}
              error={errors.password}
            >
              {(ids) => (
                <PasswordInput
                  {...ids}
                  autoComplete="new-password"
                  value={password}
                  showLabel={show}
                  hideLabel={hide}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('register.passwordConfirm', language)} error={errors.again}>
              {(ids) => (
                <PasswordInput
                  {...ids}
                  autoComplete="new-password"
                  value={again}
                  showLabel={show}
                  hideLabel={hide}
                  onChange={(e) => setAgain(e.target.value)}
                />
              )}
            </Field>
          </div>
          <div className={styles.actions}>
            <Button
              type="submit"
              variant="primary"
              className={styles.blockButton}
              disabled={busy}
            >
              {t('recover.save', language)}
            </Button>
          </div>
        </form>
      ) : null}

      {stage === 'done' ? (
        <Notice kind="success">
          <p className="small">{t('recover.done', language)}</p>
          <p className="small">
            <Link href="/farmer/login">{t('recover.signIn', language)}</Link>
          </p>
        </Notice>
      ) : null}

      {stage === 'unavailable' ? (
        <Notice kind="info">
          <p className="small">{t('recover.unavailable', language)}</p>
        </Notice>
      ) : null}

      <p className={styles.linkRow}>
        <Link href="/farmer/login">{t('recover.back', language)}</Link>
      </p>
    </div>
  );
}
