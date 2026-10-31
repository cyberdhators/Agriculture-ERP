'use client';

import css from '@/components/account/settings.module.css';
import { useFarmerSession } from '@/lib/farmer-session';
import { farmerPayamName } from '@/lib/fixtures/farmers';
import { formatDate, formatPhone } from '@/lib/format';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';

/**
 * /farmer/account/verification -- "Your record" (2026-10-31). The owner:
 * "remove verification from accounts ... not individual." A person's account is
 * never verified, so this page shows the record only: member number, name,
 * payam, date joined. The extension programme's field record (an officer's
 * check, for programme reports) is not shown to the person as an account
 * verification and gates nothing. The path is kept so old links still work.
 *
 * Laid out as the Account page's profile card and rows; the title is said
 * once (it was the page title, a lead and a card title again).
 */
export function FarmerVerification() {
  const { farmer, language } = useFarmerSession();
  if (!farmer) return null;

  const numberPending = farmer.farmer_number.endsWith('-pending');
  const initials = `${farmer.given_name.charAt(0)}${farmer.family_name.charAt(0)}`.toUpperCase();
  const rows: [string, React.ReactNode][] = [
    [t('account.phone', language), <span dir="ltr">{formatPhone(farmer.phone)}</span>],
    [t('account.payam', language), farmerPayamName(farmer.payam_id)],
    [t('account.registered', language), formatDate(farmer.created_at, language)],
  ];

  return (
    <>
      <PageHead title={t('account.tileVerification', language)} />
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
          </div>
        </section>
        <dl className={css.list}>
          {rows.map(([label, value]) => (
            <div key={label} className={css.row}>
              <dt className={css.rowText}>
                <span className={css.rowLabel}>{label}</span>
              </dt>
              <dd className={css.rowValue}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}
