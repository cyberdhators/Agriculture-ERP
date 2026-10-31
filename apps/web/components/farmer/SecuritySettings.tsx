'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { BlockedAccounts } from '@/components/account/BlockedAccounts';
import { DeleteAccount } from '@/components/account/DeleteAccount';
import css from '@/components/account/settings.module.css';
import { Button, Field, Notice, PasswordInput } from '@/components/ui';
import { validatePassword } from '@/lib/farmers/schema';
import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';

import { ChangePhone } from './ChangePhone';

type Panel = 'password' | 'phone' | null;

const LOCK = 'M6 11V8a6 6 0 1 1 12 0v3M5 11h14v10H5zM12 15v2';
const PHONE = 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 15h2';
const EXIT = 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10';

export const chevron = (
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

export function RowIcon({ d }: { d: string }) {
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

/**
 * Security as settings rows (2026-10-31), shared by Account and "Login &
 * security" so the two pages cannot drift apart again: Password and Phone
 * number open their forms in place; Blocked accounts and Delete my account
 * where the page asks for them; Sign out as one red row.
 */
export function SecuritySettings({
  blocked = false,
  deletable = false,
  titled = true,
}: {
  blocked?: boolean;
  deletable?: boolean;
  /** False where the page itself is titled "Login & security". */
  titled?: boolean;
}) {
  const { language, signOut, changePassword } = useFarmerSession();
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

  return (
    <>
      <section
        className={css.group}
        aria-labelledby={titled ? 'set-security' : undefined}
        aria-label={titled ? undefined : t('set.security', language)}
      >
        {titled ? (
          <h2 id="set-security" className={css.groupTitle}>
            {t('set.security', language)}
          </h2>
        ) : null}
        {done === 'password' ? (
          <Notice kind="success">
            <p className="small">{t('account.passwordChanged', language)}</p>
          </Notice>
        ) : null}
        {done === 'phone' ? (
          <Notice kind="success">
            <p className="small">{t('account.phoneChanged', language)}</p>
          </Notice>
        ) : null}
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
          {blocked ? <BlockedAccounts language={language} variant="row" /> : null}
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
        {/* 2026-10-20: the account deletes itself (hide now, keep for audit). */}
        {deletable ? (
          <DeleteAccount language={language === 'ar' ? 'ar' : 'en'} variant="row" />
        ) : null}
      </ul>
    </>
  );
}
