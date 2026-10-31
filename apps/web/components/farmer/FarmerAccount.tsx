'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { NotificationPreferencesCard } from '@/components/account/NotificationSettings';
import css from '@/components/account/settings.module.css';
import { Button, Field, Notice, PasswordInput } from '@/components/ui';
import { validatePassword } from '@/lib/farmers/schema';
import { farmerPayamName } from '@/lib/fixtures/farmers';
import { useFarmerSession } from '@/lib/farmer-session';
import { useArabicEnabled } from '@/lib/settings/client';
import { t, type Language } from '@/lib/i18n';
import { formatPhone } from '@/lib/format';

import { BlockedAccounts } from '@/components/account/BlockedAccounts';

import { PageHead } from './AccountShell';
import { ChangePhone } from './ChangePhone';
import styles from './farmer.module.css';

type Panel = 'password' | 'phone' | null;

const chevron = (
  <svg
    className={css.chevron}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden
  >
    <path d="m9 6 6 6-6 6" />
  </svg>
);

function RowIcon({ d }: { d: string }) {
  return (
    <span className={css.rowIcon} aria-hidden>
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={d} />
      </svg>
    </span>
  );
}

const GLOBE =
  'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z';
const LOCK = 'M6 11V8a6 6 0 1 1 12 0v3M5 11h14v10H5zM12 15v2';
const PHONE = 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 15h2';
const EXIT = 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10';

/**
 * The Account tab: who you are (name, farmer number, phone, payam) on one
 * card, then Preferences (language), Notifications, Security (password,
 * phone -- which asks for the password, B12 point 2 -- and blocked accounts)
 * and Sign out, as rows.
 *
 * 2026-10-31 (the owner: "the redundant words and style ... elite level ui"):
 * this was a titled card per setting, each title repeated on the button
 * beneath it ("Change password" over "Change password"). Every action is the
 * one it was; only the words and the layout changed.
 */
export function FarmerAccount() {
  const { farmer, language, setLanguage, signOut, changePassword } = useFarmerSession();
  const router = useRouter();
  // 2026-10-27: Arabic is offered while Settings say so.
  const arabic = useArabicEnabled();

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

  if (!farmer) return null;
  const numberPending = farmer.farmer_number.endsWith('-pending');

  function switchLanguage(lang: Language) {
    setLanguage(lang);
  }

  function open(which: Panel) {
    setPanel((p) => (p === which ? null : which));
    setDone(null);
  }

  async function submitPassword(event: React.FormEvent) {
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
    if (!(await changePassword(current, next))) {
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

  async function onSignOut() {
    await signOut();
    router.push('/');
  }

  const show = t('login.show', language);
  const hide = t('login.hide', language);
  const initials = `${farmer.given_name.charAt(0)}${farmer.family_name.charAt(0)}`.toUpperCase();

  return (
    <>
      <PageHead title={t('account.tabAccount', language)} />

      {done === 'password' ? (
        <Notice kind="success" className={styles.block}>
          <p className="small">{t('account.passwordChanged', language)}</p>
        </Notice>
      ) : null}
      {done === 'phone' ? (
        <Notice kind="success" className={styles.block}>
          <p className="small">{t('account.phoneChanged', language)}</p>
        </Notice>
      ) : null}

      <div className={css.page}>
        <section className={css.profile} aria-label={t('account.record', language)}>
          <span className={css.avatar} aria-hidden>
            {initials}
          </span>
          <div className={css.profileText}>
            <span className={css.profileName} dir="auto">
              {farmer.given_name} {farmer.family_name}
            </span>
            <span className={css.profileId}>
              {numberPending ? t('account.numberPending', language) : farmer.farmer_number}
            </span>
            <span className={css.profileMeta}>
              {/* A phone number reads left to right in Arabic too. */}
              <span dir="ltr">{formatPhone(farmer.phone)}</span>
              <span>{farmerPayamName(farmer.payam_id)}</span>
            </span>
          </div>
        </section>

        <section className={css.group} aria-labelledby="set-preferences">
          <h2 id="set-preferences" className={css.groupTitle}>
            {t('set.preferences', language)}
          </h2>
          <ul className={css.list}>
            <li className={css.row}>
              <RowIcon d={GLOBE} />
              <span className={css.rowText}>
                <span className={css.rowLabel}>{t('account.changeLanguage', language)}</span>
              </span>
              {arabic ? (
                <span
                  className={css.segmented}
                  role="group"
                  aria-label={t('account.changeLanguage', language)}
                >
                  <button
                    type="button"
                    aria-pressed={language === 'en'}
                    onClick={() => switchLanguage('en')}
                  >
                    {t('language.name', 'en')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={language === 'ar'}
                    onClick={() => switchLanguage('ar')}
                    dir="rtl"
                    lang="ar"
                  >
                    {t('language.arabicNative', 'en')}
                  </button>
                </span>
              ) : (
                <span className={css.rowValue}>{t('language.name', language)}</span>
              )}
            </li>
          </ul>
        </section>

        {/* 2026-10-27: what CORWADO may send, and how. Essential messages have no switch. */}
        <NotificationPreferencesCard language={language} emailAccount={false} />

        <section className={css.group} aria-labelledby="set-security">
          <h2 id="set-security" className={css.groupTitle}>
            {t('set.security', language)}
          </h2>
          <ul className={css.list}>
            <li>
              <button
                type="button"
                className={`${css.row} ${css.rowButton}`}
                aria-expanded={panel === 'password'}
                onClick={() => open('password')}
              >
                <RowIcon d={LOCK} />
                <span className={css.rowText}>
                  <span className={css.rowLabel}>{t('set.password', language)}</span>
                </span>
                {chevron}
              </button>
              {panel === 'password' ? (
                <form className={css.panel} onSubmit={submitPassword} noValidate>
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
                  <Field
                    label={t('register.passwordConfirm', language)}
                    error={passwordErrors.again}
                  >
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
                  <div>
                    <Button type="submit" variant="primary">
                      {t('account.changePassword', language)}
                    </Button>
                  </div>
                </form>
              ) : null}
            </li>
            <li>
              <button
                type="button"
                className={`${css.row} ${css.rowButton}`}
                aria-expanded={panel === 'phone'}
                onClick={() => open('phone')}
              >
                <RowIcon d={PHONE} />
                <span className={css.rowText}>
                  <span className={css.rowLabel}>{t('set.phone', language)}</span>
                </span>
                {chevron}
              </button>
              {panel === 'phone' ? (
                <div className={css.panel}>
                  <ChangePhone
                    language={language}
                    onDone={() => {
                      setPanel(null);
                      setDone('phone');
                    }}
                  />
                </div>
              ) : null}
            </li>
            {/* 2026-10-28: person-level blocks, with Unblock. */}
            <BlockedAccounts language={language} variant="row" />
          </ul>
        </section>

        <ul className={css.list}>
          <li>
            <button
              type="button"
              className={`${css.row} ${css.rowButton} ${css.danger}`}
              onClick={onSignOut}
            >
              <RowIcon d={EXIT} />
              <span className={css.rowText}>
                <span className={css.rowLabel}>{t('account.signOut', language)}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </>
  );
}
