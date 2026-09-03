'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { parseSouthSudanMobile } from '@agri-erp/shared';

import { Button, Field, Input, Notice, PrefixedInput } from '@/components/ui';
import { FARMER_DEV_CODE, farmerByPhone } from '@/lib/fixtures/farmers';
import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';
import { formatPhone } from '@/lib/format';

import styles from './farmer.module.css';

const CODE_TTL_S = 10 * 60; // 10-minute code lifetime (B12 point 2)
const RESEND_AFTER_S = 60; // resend allowed after 60s
const MAX_ATTEMPTS = 5; // 5 wrong codes, then locked (B12 point 2)

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Sign in by phone and a one-time code — no password (B12 point 2). The dev
 * code 123456 stands in for the SMS until C-15; an unknown phone still reaches
 * the code screen, so the screen never reveals whether a number is registered
 * (no enumeration). Ten-minute lifetime, resend after a minute, locked after
 * five wrong codes.
 */
export function FarmerLogin() {
  const { language, signIn } = useFarmerSession();
  const router = useRouter();

  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [phoneRaw, setPhoneRaw] = useState('');
  const [e164, setE164] = useState('');
  const [phoneError, setPhoneError] = useState<string | undefined>();

  const [code, setCode] = useState('');
  const [ttl, setTtl] = useState(CODE_TTL_S);
  const [resendIn, setResendIn] = useState(RESEND_AFTER_S);
  const [attempts, setAttempts] = useState(0);
  const [codeError, setCodeError] = useState<string | undefined>();
  const [unknown, setUnknown] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  const locked = attempts >= MAX_ATTEMPTS;
  const expired = ttl <= 0;

  // Countdowns run only on the code screen and only in the browser.
  useEffect(() => {
    if (stage !== 'code') return;
    const id = window.setInterval(() => {
      setTtl((v) => (v > 0 ? v - 1 : 0));
      setResendIn((v) => (v > 0 ? v - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [stage]);

  function sendCode() {
    const parsed = parseSouthSudanMobile(phoneRaw);
    if (!parsed.ok) {
      setPhoneError(parsed.message);
      return;
    }
    setPhoneError(undefined);
    setE164(parsed.value);
    startCodeScreen();
  }

  function startCodeScreen() {
    setStage('code');
    setCode('');
    setTtl(CODE_TTL_S);
    setResendIn(RESEND_AFTER_S);
    setAttempts(0);
    setCodeError(undefined);
    setUnknown(false);
    requestAnimationFrame(() => codeRef.current?.focus());
  }

  function verify() {
    if (locked || expired) return;
    if (code !== FARMER_DEV_CODE) {
      const next = attempts + 1;
      setAttempts(next);
      setCodeError(
        next >= MAX_ATTEMPTS ? t('login.lockout', language) : t('login.wrongCode', language),
      );
      return;
    }
    const farmer = farmerByPhone(e164);
    if (!farmer) {
      // The code was right but there is no account for this number.
      setUnknown(true);
      return;
    }
    signIn(farmer.id);
    router.push('/farmer/account');
  }

  if (stage === 'phone') {
    return (
      <div className={styles.sheet}>
        <p className={styles.eyebrow}>{t('brand.tagline', language)}</p>
        <h1 className={styles.h1}>{t('login.title', language)}</h1>

        <div className={styles.stack}>
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
                value={phoneRaw}
                onChange={(e) => setPhoneRaw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendCode();
                }}
              />
            )}
          </Field>
        </div>

        <div className={styles.actions}>
          <Button variant="primary" className={styles.blockButton} onClick={sendCode}>
            {t('login.sendCode', language)}
          </Button>
        </div>

        <p className={styles.linkRow}>
          {t('login.newHere', language)}{' '}
          <Link href="/farmer/register">{t('login.register', language)}</Link>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.sheet}>
      <p className={styles.eyebrow}>{t('login.title', language)}</p>
      <h1 className={styles.h1}>{t('login.codeTitle', language)}</h1>
      <p className={styles.lede}>
        {t('login.codeSentTo', language)}{' '}
        <span className={styles.codeSentTo}>{formatPhone(e164)}</span>
      </p>

      {unknown ? (
        <Notice kind="info">
          <p className="small">
            {t('login.newHere', language)}{' '}
            <Link href="/farmer/register">{t('login.register', language)}</Link>
          </p>
        </Notice>
      ) : null}

      <div className={styles.stack} style={{ marginBlockStart: 'var(--s-4)' }}>
        <Field
          label={t('login.codeLabel', language)}
          error={
            locked
              ? t('login.lockout', language)
              : expired
                ? t('login.expired', language)
                : codeError
          }
        >
          {(ids) => (
            <Input
              {...ids}
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className={styles.codeInput}
              placeholder="––––––"
              value={code}
              disabled={locked}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                setCodeError(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') verify();
              }}
            />
          )}
        </Field>

        <div className={styles.codeMeta}>
          <span>
            {t('login.expiresIn', language)} <span className="mono">{mmss(ttl)}</span>
          </span>
          {resendIn > 0 ? (
            <span>
              {t('login.resendIn', language)} <span className="mono">{resendIn}</span>{' '}
              {t('login.seconds', language)}
            </span>
          ) : (
            <button type="button" className={styles.textLink} onClick={startCodeScreen}>
              {t('login.resend', language)}
            </button>
          )}
        </div>
      </div>

      <div className={styles.actions}>
        <Button
          variant="primary"
          className={styles.blockButton}
          onClick={verify}
          disabled={locked || expired || code.length < 6}
        >
          {t('login.verify', language)}
        </Button>
        <button
          type="button"
          className={styles.textLink}
          onClick={() => {
            setStage('phone');
            setCodeError(undefined);
          }}
        >
          {t('login.changeNumber', language)}
        </button>
      </div>
    </div>
  );
}
