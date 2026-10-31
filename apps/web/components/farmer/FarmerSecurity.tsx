'use client';

import css from '@/components/account/settings.module.css';
import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import { SecuritySettings } from './SecuritySettings';

/**
 * "Login & security": password, phone number, sign out and delete my account,
 * as the same rows the Account page uses (2026-10-31; it was a titled card per
 * action, each title repeated on its button, and the phone number shown on a
 * card of its own above "Change phone number").
 */
export function FarmerSecurity() {
  const { farmer, language } = useFarmerSession();
  if (!farmer) return null;

  return (
    <>
      <PageHead title={t('account.tileSecurity', language)} />
      <div className={css.page}>
        <SecuritySettings deletable titled={false} />
      </div>
    </>
  );
}
