'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { parseSouthSudanMobile } from '@agri-erp/shared';

import { Button, Field, Notice, PasswordInput, PrefixedInput } from '@/components/ui';
import { validatePassword } from '@/lib/farmers/schema';
import { farmerPayamName } from '@/lib/fixtures/farmers';
import { useFarmerSession } from '@/lib/farmer-session';
import { t, type Language } from '@/lib/i18n';
import { formatPhone } from '@/lib/format';

import { PageHead } from './AccountShell';
import styles from './farmer.module.css';

type Panel = 'password' | 'phone' | null;

/**
 * The Account tab: the record as it stands (name, farmer number, phone,
 * payam), the language choice, change password (current, new, again), change
 * phone (asks for the password, B12 point 2) and sign out — four ruled cards
 * on a two-column grid.
 */
export function FarmerAccount() {
  const { farmer, language, setLanguage, signOut, changePassword, changePhone } =
    useFarmerSession();
  const router = useRouter();

  const [panel, setPanel] = useState<Panel>(null);
  const [done, setDone] = useState<'password' | 'phone' | null>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<{
    current?: string;
    next?: string;
    again?: string;
  }>({});

  const [phonePassword, setPhonePassword] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [phoneErrors, setPhoneErrors] = useState<{ password?: string; phone?: string }>({});

  if (!farmer) return null;
  const numberPending = farmer.farmer_number.endsWith('-pending');

  function switchLanguage(lang: Language) {
    setLanguage(lang);
  }

  function open(which: Panel) {
    setPanel((p) => (p === which ? null : which));
    setDone(null);
  }

  function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    const errors: typeof passwordErrors = {};
    if (current === '') errors.current = t('account.wrongPassword', language);
    const nextError = validatePassword(next);
    if (nextError) errors.next = t('register.passwordHint', language);
    else if (again !== next) errors.again = t('register.passwordMismatch', language);
    if (Object.keys(errors).length > 0) {
      setPasswordErrors(errors);
      return;
    }
    if (!changePassword(current, next)) {
      setPasswordErrors({ current: t('account.wrongPassword', language) });
      return;
    }
    setPasswordErrors({});
    setCurrent('');
    setNext('');
    setAgain('');
    setPanel(null);
    setDone('password');
  }

  function submitPhone(event: React.FormEvent) {
    event.preventDefault();
    const errors: typeof phoneErrors = {};
    const parsed = parseSouthSudanMobile(newPhone);
    if (!parsed.ok) errors.phone = parsed.message;
    if (phonePassword === '') errors.password = t('account.wrongPassword', language);
    if (Object.keys(errors).length > 0 || !parsed.ok) {
      setPhoneErrors(errors);
      return;
    }
    if (!changePhone(phonePassword, parsed.value)) {
      setPhoneErrors({ password: t('account.wrongPassword', language) });
      return;
    }
    setPhoneErrors({});
    setPhonePassword('');
    setNewPhone('');
    setPanel(null);
    setDone('phone');
  }

  function onSignOut() {
    signOut();
    router.push('/');
  }

  const show = t('login.show', language);
  const hide = t('login.hide', language);

  return (
    <>
      <PageHead title={t('account.tabAccount', language)} />

      {done === 'password' ? (
        <Notice kind="success" className={styles.block}>
          <p className="small">{t('account.passwordChanged', language)}</p>
        </Notice>
      ) : null}
      {done === 'phone' ? (
        <Notice kind="success">
          <p className="small">{t('account.phoneChanged', language)}</p>
        </Notice>
      ) : null}

      <div className={styles.settings}>
        <section className={styles.settingCard}>
          <h2>{t('account.record', language)}</h2>
          <dl className={styles.recordRows}>
            <div className={styles.recordRow}>
              <dt>{t('account.name', language)}</dt>
              <dd dir="auto">
                {farmer.given_name} {farmer.family_name}
              </dd>
            </div>
            <div className={styles.recordRow}>
              <dt>{t('account.farmerNumber', language)}</dt>
              <dd className={styles.recordValueMono}>
                {numberPending ? '—' : farmer.farmer_number}
                {numberPending ? (
                  <span className={styles.recordNote}>{t('account.numberPending', language)}</span>
                ) : null}
              </dd>
            </div>
            <div className={styles.recordRow}>
              <dt>{t('account.phone', language)}</dt>
              <dd className={styles.recordValueMono}>{formatPhone(farmer.phone)}</dd>
            </div>
            <div className={styles.recordRow}>
              <dt>{t('account.payam', language)}</dt>
              <dd>{farmerPayamName(farmer.payam_id)}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.settingCard}>
          <h2>{t('account.changeLanguage', language)}</h2>
          <p className="small muted">{t('language.subtitle', language)}</p>
          <div className={styles.choiceRow}>
            <button
              type="button"
              className={`${styles.choice} ${language === 'en' ? styles.choiceSelected : ''}`}
              aria-pressed={language === 'en'}
              onClick={() => switchLanguage('en')}
            >
              {t('language.name', language)}
            </button>
            <button
              type="button"
              className={`${styles.choice} ${language === 'ar' ? styles.choiceSelected : ''}`}
              aria-pressed={language === 'ar'}
              onClick={() => switchLanguage('ar')}
              dir="rtl"
              lang="ar"
            >
              {t('language.arabicNative', language)}
            </button>
          </div>
        </section>

        <section className={styles.settingCard}>
          <h2>{t('account.changePassword', language)}</h2>
          <div>
            <Button
              variant="secondary"
              aria-expanded={panel === 'password'}
              onClick={() => open('password')}
            >
              {t('account.changePassword', language)}
            </Button>
            {panel === 'password' ? (
              <form className={styles.inlineForm} onSubmit={submitPassword} noValidate>
                <Field
                  label={t('account.currentPassword', language)}
                  error={passwordErrors.current}
                >
                  {(ids) => (
                    <PasswordInput
                      {...ids}
                      autoComplete="current-password"
                      value={current}
                      showLabel={show}
                      hideLabel={hide}
                      onChange={(e) => setCurrent(e.target.value)}
                    />
                  )}
                </Field>
                <Field
                  label={t('account.newPassword', language)}
                  hint={t('register.passwordHint', language)}
                  error={passwordErrors.next}
                >
                  {(ids) => (
                    <PasswordInput
                      {...ids}
                      autoComplete="new-password"
                      value={next}
                      showLabel={show}
                      hideLabel={hide}
                      onChange={(e) => setNext(e.target.value)}
                    />
                  )}
                </Field>
                <Field label={t('register.passwordConfirm', language)} error={passwordErrors.again}>
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
                <Button type="submit" variant="primary">
                  {t('account.changePassword', language)}
                </Button>
              </form>
            ) : null}
          </div>
        </section>

        <section className={styles.settingCard}>
          <h2>{t('account.changePhone', language)}</h2>
          <p className="small muted">{t('account.changePhoneNote', language)}</p>
          <div>
            <Button
              variant="secondary"
              aria-expanded={panel === 'phone'}
              onClick={() => open('phone')}
            >
              {t('account.changePhone', language)}
            </Button>
            {panel === 'phone' ? (
              <form className={styles.inlineForm} onSubmit={submitPhone} noValidate>
                <Field label={t('account.newPhone', language)} error={phoneErrors.phone}>
                  {(ids) => (
                    <PrefixedInput
                      {...ids}
                      prefix="+211"
                      inputMode="tel"
                      autoComplete="tel-national"
                      className="mono"
                      placeholder="9XX XXX XXX"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                    />
                  )}
                </Field>
                <Field
                  label={t('login.passwordLabel', language)}
                  hint={t('account.changePhoneNote', language)}
                  error={phoneErrors.password}
                >
                  {(ids) => (
                    <PasswordInput
                      {...ids}
                      autoComplete="current-password"
                      value={phonePassword}
                      showLabel={show}
                      hideLabel={hide}
                      onChange={(e) => setPhonePassword(e.target.value)}
                    />
                  )}
                </Field>
                <Button type="submit" variant="primary">
                  {t('account.changePhone', language)}
                </Button>
              </form>
            ) : null}
          </div>
        </section>

        <section className={styles.settingCard}>
          <h2>{t('account.signOut', language)}</h2>
          <div>
            <Button variant="ghost" onClick={onSignOut}>
              {t('account.signOut', language)}
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
