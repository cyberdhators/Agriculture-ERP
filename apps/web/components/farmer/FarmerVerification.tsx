'use client';

import { Notice, Stamp } from '@/components/ui';
import { useFarmerSession } from '@/lib/farmer-session';
import { farmerPayamName } from '@/lib/fixtures/farmers';
import { VERIFICATION_KEY, verificationStamp } from '@/lib/farmers/verification';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import styles from './farmer.module.css';

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
          <h2>{t('account.kpiVerification', language)}</h2>
          <div style={{ marginTop: 'var(--s-2)', marginBottom: 'var(--s-3)' }}>
            <Stamp kind={verificationStamp(farmer.verification_status)}>
              {t(VERIFICATION_KEY[farmer.verification_status], language)}
            </Stamp>
          </div>

          {farmer.verification_status === 'pending' ? (
            <Notice kind="warn" title={t('account.whatPendingTitle', language)}>
              <p className="small">{t('account.whatPendingBody', language)}</p>
            </Notice>
          ) : null}

          {farmer.verification_status === 'rejected' ? (
            <Notice kind="error" title={t('account.rejected', language)}>
              <p className="small">{t('account.whatRejectedBody', language)}</p>
            </Notice>
          ) : null}

          {farmer.verification_status === 'verified' ? (
            <p className="small muted">{t('account.verified', language)}</p>
          ) : null}
        </section>

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
