'use client';

import { useEffect, useState } from 'react';

import { parseSouthSudanMobile, resendWaitSeconds, type RecoveryCodeSent } from '@agri-erp/shared';

import { Button, Field, Input, Notice, PasswordInput, PrefixedInput } from '@/components/ui';
import { FarmerApiError, farmerApi, useFarmerSession } from '@/lib/farmer-session';
import { t, type Language } from '@/lib/i18n';

import styles from './farmer.module.css';

/** Seconds left before another code may be asked for, ticking once a second. */
export function useResendWait(lastSentAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!lastSentAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [lastSentAt]);
  return resendWaitSeconds(lastSentAt, now);
}

/** "Send the code again", or how long until it can be. */
export function ResendCode({
  language,
  wait,
  busy,
  onResend,
}: {
  language: Language;
  wait: number;
  busy: boolean;
  onResend: () => void;
}) {
  return wait > 0 ? (
    <p className="small muted" role="status">
      {t('recover.resendWait', language)} {wait} {t('recover.seconds', language)}
    </p>
  ) : (
    <Button variant="ghost" onClick={onResend} disabled={busy}>
      {t('recover.resend', language)}
    </Button>
  );
}

/**
 * A VERIFIED CHANGE OF NUMBER (2026-10-27, CORWADO's specification: "Provide
 * resend, change-number and secure recovery functions").
 *
 *   1. The new number and the account's password. A code is sent by SMS to
 *      the NEW number (POST /api/farmer/me/phone-code).
 *   2. The code (POST /api/farmer/me/phone-code/verify), then the change
 *      (PATCH /api/farmer/me), which checks the password on the server and
 *      uses the verified code up. The old number is told by SMS.
 *
 * When this deployment sends no codes, step 1 makes the change at once with
 * the password alone, as before. Needs signal.
 */
export function ChangePhone({ language, onDone }: { language: Language; onDone: () => void }) {
  const { changePhone } = useFarmerSession();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ id: string; phone: string; at: string } | null>(null);
  // A code already verified for this number: a wrong password then needs no new SMS.
  const [verifiedFor, setVerifiedFor] = useState<{ id: string; phone: string } | null>(null);
  const [errors, setErrors] = useState<{ phone?: string; password?: string; code?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wait = useResendWait(sent?.at ?? null);

  const show = t('login.show', language);
  const hide = t('login.hide', language);

  function explain(error: unknown) {
    if (error instanceof FarmerApiError) {
      if (error.fields.phone) return setErrors({ phone: error.fields.phone });
      if (error.fields.password || /password/i.test(error.message)) {
        // Back to the first step, where the password is typed again.
        setSent(null);
        return setErrors({ password: error.fields.password ?? error.message });
      }
      return setFailure(error.message);
    }
    setFailure(t('recover.failed', language));
  }

  async function finish(value: string, verificationId?: string) {
    await changePhone(password, value, verificationId);
    setPhone('');
    setPassword('');
    setCode('');
    setSent(null);
    setVerifiedFor(null);
    onDone();
  }

  async function sendCode(value: string) {
    const answer = await farmerApi<RecoveryCodeSent>('/api/farmer/me/phone-code', {
      method: 'POST',
      body: JSON.stringify({ phone: value }),
      headers: { 'accept-language': language === 'ar' ? 'ar' : 'en' },
    });
    if (!answer.available || !answer.verification_id) return false;
    setSent({ id: answer.verification_id, phone: value, at: new Date().toISOString() });
    setCode('');
    return true;
  }

  async function start(event: React.FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    const parsed = parseSouthSudanMobile(phone);
    if (!parsed.ok) next.phone = parsed.message;
    if (password === '') next.password = t('account.wrongPassword', language);
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length > 0 || !parsed.ok) return;
    setBusy(true);
    try {
      if (verifiedFor && verifiedFor.phone === parsed.value) {
        await finish(parsed.value, verifiedFor.id);
      } else if (!(await sendCode(parsed.value))) {
        await finish(parsed.value);
      }
    } catch (error) {
      explain(error);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!sent) return;
    setErrors({});
    setFailure(null);
    setBusy(true);
    let verified = false;
    try {
      await farmerApi('/api/farmer/me/phone-code/verify', {
        method: 'POST',
        body: JSON.stringify({ verification_id: sent.id, code: code.trim() }),
      });
      verified = true;
      setVerifiedFor({ id: sent.id, phone: sent.phone });
      await finish(sent.phone, sent.id);
    } catch (error) {
      // A refused code is shown under the code; a refused change (the
      // password, a number already in use) as the change's own reason.
      if (!verified && error instanceof FarmerApiError && error.status !== 0) {
        setErrors({ code: error.fields.code ?? error.message });
      } else {
        explain(error);
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!sent) return;
    setBusy(true);
    setFailure(null);
    try {
      await sendCode(sent.phone);
    } catch (error) {
      explain(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}
      {sent === null ? (
        <form className={styles.inlineForm} onSubmit={start} noValidate>
          <Field
            label={t('account.newPhone', language)}
            hint={t('account.changePhoneCodeNote', language)}
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
          <Field
            label={t('login.passwordLabel', language)}
            hint={t('account.changePhoneNote', language)}
            error={errors.password}
          >
            {(ids) => (
              <PasswordInput
                {...ids}
                autoComplete="current-password"
                value={password}
                showLabel={show}
                hideLabel={hide}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t('recover.sending', language) : t('account.changePhone', language)}
          </Button>
        </form>
      ) : (
        <form className={styles.inlineForm} onSubmit={confirm} noValidate>
          <p className="small">{t('account.phoneCodeSent', language)}</p>
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
          <Button type="submit" variant="primary" disabled={busy || code.trim().length !== 6}>
            {t('account.phoneConfirm', language)}
          </Button>
          <ResendCode language={language} wait={wait} busy={busy} onResend={() => void resend()} />
          <Button
            variant="ghost"
            onClick={() => {
              setSent(null);
              setCode('');
              setFailure(null);
            }}
            disabled={busy}
          >
            {t('recover.otherNumber', language)}
          </Button>
        </form>
      )}
    </>
  );
}
