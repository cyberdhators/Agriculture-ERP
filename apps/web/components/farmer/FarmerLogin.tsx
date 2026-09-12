'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { parseSouthSudanMobile } from '@agri-erp/shared';

import { Button, Field, Notice, PasswordInput, PrefixedInput } from '@/components/ui';
import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';

import styles from './farmer.module.css';

/**
 * Sign in by phone and password — the same mechanism as officers (B12 point
 * 2). One form, one submit. A wrong password and an unknown number fail with
 * the same sentence, so the screen never reveals whether a number is on the
 * register; the fifth failure locks the number. Forgotten passwords are reset
 * by an officer or CORWADO: there is no code flow until C-15 exists.
 */
export function FarmerLogin() {
  const { language, signIn } = useFarmerSession();
  const router = useRouter();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [failure, setFailure] = useState<'wrong' | 'locked' | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseSouthSudanMobile(phone);
    if (!parsed.ok) {
      setPhoneError(parsed.message);
      return;
    }
    setPhoneError(undefined);
    const result = signIn(parsed.value, password);
    if (!result.ok) {
      setFailure(result.reason);
      setPassword('');
      return;
    }
    router.push('/farmer/account');
  }

  const locked = failure === 'locked';

  return (
    <form className={styles.sheet} onSubmit={submit} noValidate>
      <p className={styles.eyebrow}>{t('brand.tagline', language)}</p>
      <h1 className={styles.h1}>{t('login.title', language)}</h1>

      {failure ? (
        <Notice kind="error">
          <p className="small">{t(locked ? 'login.locked' : 'login.failed', language)}</p>
        </Notice>
      ) : null}

      <div className={styles.stack} style={{ marginBlockStart: 'var(--s-4)' }}>
        <Field
          label={t('login.phoneLabel', language)}
          hint={t('login.phoneHint', language)}
          error={phoneError}
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
              disabled={locked}
              onChange={(e) => {
                setPhone(e.target.value);
                setFailure(null);
              }}
            />
          )}
        </Field>

        <Field label={t('login.passwordLabel', language)}>
          {(ids) => (
            <PasswordInput
              {...ids}
              autoComplete="current-password"
              value={password}
              disabled={locked}
              showLabel={t('login.show', language)}
              hideLabel={t('login.hide', language)}
              onChange={(e) => {
                setPassword(e.target.value);
                setFailure(null);
              }}
            />
          )}
        </Field>
      </div>

      <div className={styles.actions}>
        <Button type="submit" variant="primary" className={styles.blockButton} disabled={locked}>
          {t('login.submit', language)}
        </Button>
      </div>

      <p className={styles.helpRow}>
        <span className={styles.helpTitle}>{t('login.forgotTitle', language)}</span>{' '}
        {t('login.forgotBody', language)}
      </p>

      <p className={styles.linkRow}>
        {t('login.newHere', language)}{' '}
        <Link href="/farmer/register">{t('login.register', language)}</Link>
      </p>
    </form>
  );
}
