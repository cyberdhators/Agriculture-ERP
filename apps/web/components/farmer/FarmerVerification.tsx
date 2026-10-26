'use client';

import { useFarmerSession } from '@/lib/farmer-session';
import { farmerPayamName } from '@/lib/fixtures/farmers';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import styles from './farmer.module.css';

/**
 * /farmer/account/verification -- "Your record" (2026-10-31). The owner:
 * "remove verification from accounts ... not individual." A person's account is
 * never verified, so this page shows the record only: member number, name,
 * payam, date joined. The extension programme's field record (an officer's
 * check, for programme reports) is not shown to the person as an account
 * verification and gates nothing. The path is kept so old links still work.
 */
export function FarmerVerification() {
  const { farmer, language } = useFarmerSession();
  if (!farmer) return null;

  const numberPending = farmer.farmer_number.endsWith('-pending');

  return (
    <>
      <PageHead
        title={t('account.tileVerification', language)}
        lead={t('account.tileVerificationSub', language)}
      />

      <div className={styles.settings}>
        <section className={styles.settingCard}>
          <h2>{t('account.record', language)}</h2>
          <dl className={styles.recordRows}>
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
              <dt>{t('account.name', language)}</dt>
              <dd dir="auto">
                {farmer.given_name} {farmer.family_name}
              </dd>
            </div>
            <div className={styles.recordRow}>
              <dt>{t('account.payam', language)}</dt>
              <dd>{farmerPayamName(farmer.payam_id)}</dd>
            </div>
            <div className={styles.recordRow}>
              <dt>{t('account.registered', language)}</dt>
              <dd className={styles.recordValueMono}>{formatDate(farmer.created_at, language)}</dd>
            </div>
          </dl>
        </section>
      </div>
    </>
  );
}
