'use client';

import { SIGN_IN_ANNOUNCE_HEADER } from '@agri-erp/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Wordmark } from '@/components/brand/Wordmark';
import { LanguageButtons } from '@/components/farmer/LanguageSwitch';
import { Button, Card, Field, Input, Notice } from '@/components/ui';
import { loginIdentifier } from '@/lib/auth/identifier';
import { BUYER_REGISTER_PATH, homeFor } from '@/lib/auth/paths';
import { serverSignIn } from '@/lib/auth/server-sign-in';
import { DEFAULT_LANGUAGE, isRtl, t, type Language } from '@/lib/i18n';
import { useDocumentLanguage, useLanguageChoice } from '@/lib/i18n/client';

import { MfaCodeStep } from './MfaCodeStep';

import styles from './auth.module.css';

/** "5 minutes", in the reader's language. */
function waitWords(seconds: number, language: Language): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1
    ? t('email.login.minute', language)
    : t('email.login.minutes', language).replace('{n}', String(minutes));
}

/**
 * Staff sign-in. Email — or, for an extension officer, a phone number, from
 * which the account identifier is derived (lib/auth/identifier.ts) — and
 * password go to Supabase Auth; on success the session cookie is set in the
 * browser and the routes' requireRole reads it from then on. The error never
 * says which of the two was wrong.
 */
export function LoginForm({
  next,
  audience = 'buyer',
  initialLanguage = DEFAULT_LANGUAGE,
}: {
  next: string;
  /** 2026-10-09: /login is the buyer sign-in; /admin/login is the staff sign-in. */
  audience?: 'buyer' | 'staff';
  /** 2026-10-29: the email sign-in speaks English or Arabic; the staff sign-in English. */
  initialLanguage?: Language;
}) {
  const staff = audience === 'staff';
  const [chosen, setLanguage] = useLanguageChoice(initialLanguage);
  const language: Language = staff ? 'en' : chosen;
  useDocumentLanguage(language);
  const w = (key: Parameters<typeof t>[0]) => t(key, language);
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // 2026-10-28: the account has an authenticator; the code is asked next.
  const [codeStep, setCodeStep] = useState(false);

  async function finish() {
    // B13: the session now exists; ask the server who it belongs to. A buyer
    // goes to the buyer side, staff to where they were going. If the answer
    // does not come, staff routing is the default and the portal's own
    // check sends a buyer on (lib/preview.tsx).
    // The one header: tells the access log this visit IS a sign-in (staff
    // permissions lane, 2026-10-19). It changes nothing about the answer.
    const role = await fetch('/api/me', { headers: { [SIGN_IN_ANNOUNCE_HEADER]: '1' } })
      .then(async (res) => ((await res.json()) as { data?: { role?: string } }).data?.role)
      .catch(() => undefined);
    router.replace(homeFor(role, next));
    router.refresh();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      // 2026-10-28: through the server (POST /api/auth/sign-in), so a failed
      // sign-in is recorded in the access log and attempts are limited. The
      // session cookie arrives on that response.
      const outcome = await serverSignIn(loginIdentifier(login), password);
      if (!outcome.ok) {
        setError(
          outcome.reason === 'suspended'
            ? w('login.suspended')
            : outcome.reason === 'wrong'
              ? w('email.login.wrong')
              : outcome.reason === 'locked'
                ? w('email.login.locked').replace(
                    '{wait}',
                    waitWords(outcome.retryAfterSeconds, language),
                  )
                : w('email.login.unreachable'),
        );
        return;
      }
      if (outcome.mfaRequired) {
        setCodeStep(true);
        return;
      }
      await finish();
    } catch {
      setError(w('email.login.notAvailable'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.wrap} dir={isRtl(language) ? 'rtl' : 'ltr'}>
      <Card padded className={styles.card}>
        <div className={styles.brand}>
          <Wordmark size={28} tagline />
        </div>
        {/* 2026-10-29: English / العربية on the email sign-in; the choice is kept. */}
        {staff ? null : <LanguageButtons value={language} onChange={setLanguage} />}
        <div>
          <h1 className={styles.title}>{staff ? 'Staff sign in' : w('email.login.title')}</h1>
          {staff ? (
            <p className={styles.hint}>
              For CORWADO staff and extension officers. Staff sign in with their email address;
              extension officers with their phone number. Accounts are issued by an administrator.
            </p>
          ) : (
            <p className={styles.hint}>
              {w('email.login.hint')} <a href="/farmer/login">{w('email.login.phoneLink')}</a>.
            </p>
          )}
        </div>

        {codeStep ? (
          <MfaCodeStep
            onVerified={() => void finish()}
            intro={w('email.login.mfaIntro')}
            language={language}
          />
        ) : null}

        {codeStep ? null : error ? (
          <Notice kind="error" title={w('email.login.notSignedIn')}>
            <p className="small">{error}</p>
          </Notice>
        ) : null}

        <form className={styles.form} onSubmit={onSubmit} noValidate hidden={codeStep}>
          <Field label={w('email.login.identifier')}>
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
          <Field label={w('login.passwordLabel')}>
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
            {busy ? w('email.login.signingIn') : w('login.submit')}
          </Button>
        </form>
        {staff ? (
          <p className={styles.hint}>
            Forgot your password? Staff: <a href="/forgot-password">reset it by email</a>. Extension
            officers: ask an administrator.
          </p>
        ) : null}
        {staff ? (
          <p className={styles.hint}>
            Not staff? <a href="/join">Sign in or create an account</a> to buy, sell and get advice.
          </p>
        ) : (
          <>
            <p className={styles.hint}>
              {w('login.forgotTitle')} <a href="/forgot-password">{w('email.login.resetLink')}</a>.
            </p>
            <p className={styles.hint}>
              {w('login.newHere')} <a href={BUYER_REGISTER_PATH}>{w('email.login.createEmail')}</a>
              {w('email.login.or')} <a href="/farmer/register">{w('email.login.withPhone')}</a>.
            </p>
          </>
        )}
      </Card>
    </main>
  );
}
