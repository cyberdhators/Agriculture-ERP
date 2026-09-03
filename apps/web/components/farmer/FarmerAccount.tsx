'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, ButtonLink, Notice, Stamp } from '@/components/ui';
import { Boundary } from '@/components/farmers/Boundary';
import { farmerPayamName, farmsForFarmer, type VerificationStatus } from '@/lib/fixtures/farmers';
import { useFarmerSession } from '@/lib/farmer-session';
import { t, type Language } from '@/lib/i18n';
import { formatPhone, pluralise } from '@/lib/format';

import styles from './farmer.module.css';

const STATUS_STAMP = {
  pending: 'pending',
  verified: 'verified',
  rejected: 'rejected',
} as const;

const STATUS_KEY: Record<
  VerificationStatus,
  'account.pending' | 'account.verified' | 'account.rejected'
> = {
  pending: 'account.pending',
  verified: 'account.verified',
  rejected: 'account.rejected',
};

/**
 * The farmer's own record: name, phone, payam, the verification stamp, a plain
 * note on what pending or not-verified means, any farms an officer has mapped
 * (the same inline-SVG boundary the staff dossier uses, at a small size) and a
 * summary of their produce. Below it the account actions: change language,
 * change phone (which re-verifies by code) and sign out.
 */
export function FarmerAccount() {
  const { hydrated, farmer, language, setLanguage, signOut, listingsFor } = useFarmerSession();
  const router = useRouter();
  const [showPhone, setShowPhone] = useState(false);

  // No session: send them to sign in. Own-record-only is the B12 rule; here the
  // stub simply has nothing to show without a session.
  useEffect(() => {
    if (hydrated && !farmer) router.replace('/farmer/login');
  }, [hydrated, farmer, router]);

  if (!hydrated || !farmer) return null;

  const farms = farmsForFarmer(farmer.id);
  const listings = listingsFor(farmer.id);
  const status = farmer.verification_status;

  function switchLanguage(lang: Language) {
    setLanguage(lang);
  }

  function onSignOut() {
    signOut();
    router.push('/farmer');
  }

  return (
    <div className={styles.sheet}>
      <p className={styles.eyebrow}>{t('brand.tagline', language)}</p>
      <div className={styles.sectionHead}>
        <h1 className={styles.h1} style={{ marginBlockEnd: 0 }} dir="auto">
          {farmer.given_name} {farmer.family_name}
        </h1>
        <Stamp kind={STATUS_STAMP[status]}>{t(STATUS_KEY[status], language)}</Stamp>
      </div>

      <div className={styles.recordRows}>
        <div className={styles.recordRow}>
          <span className={styles.recordTerm}>{t('account.phone', language)}</span>
          <span className={`${styles.recordValue} ${styles.recordValueMono}`}>
            {formatPhone(farmer.phone)}
          </span>
        </div>
        <div className={styles.recordRow}>
          <span className={styles.recordTerm}>{t('account.payam', language)}</span>
          <span className={styles.recordValue}>{farmerPayamName(farmer.payam_id)}</span>
        </div>
      </div>

      {status === 'pending' ? (
        <Notice kind="warn" title={t('account.whatPendingTitle', language)}>
          <p className="small">{t('account.whatPendingBody', language)}</p>
        </Notice>
      ) : null}
      {status === 'rejected' ? (
        <Notice kind="error" title={t('account.rejected', language)}>
          <p className="small">{t('account.whatRejectedBody', language)}</p>
        </Notice>
      ) : null}

      {/* Farms */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t('account.farms', language)}</h2>
        </div>
        {farms.length === 0 ? (
          <p className="muted">{t('account.noFarms', language)}</p>
        ) : (
          <div className={styles.farms}>
            {farms.map((farm) => (
              <div key={farm.id} className={styles.farmCard}>
                <Boundary farm={farm} size={96} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Listings summary */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t('account.listings', language)}</h2>
          <span className="mono muted small">{pluralise(listings.length, 'listing')}</span>
        </div>
        <ButtonLink
          href="/farmer/account/listings"
          variant="secondary"
          className={styles.blockButton}
        >
          {t('account.viewListings', language)}
        </ButtonLink>
      </section>

      {/* Account actions */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t('account.actions', language)}</h2>
        </div>

        <div className={styles.stackTight}>
          <div>
            <p className={styles.progressLabel}>{t('account.changeLanguage', language)}</p>
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
                className={`${styles.choice} ${language === 'ar-juba' ? styles.choiceSelected : ''}`}
                aria-pressed={language === 'ar-juba'}
                onClick={() => switchLanguage('ar-juba')}
                dir="rtl"
                lang="ar"
              >
                {t('language.arjubaNative', language)}
              </button>
            </div>
          </div>

          <div>
            <Button
              variant="secondary"
              className={styles.blockButton}
              aria-expanded={showPhone}
              onClick={() => setShowPhone((v) => !v)}
            >
              {t('account.changePhone', language)}
            </Button>
            {showPhone ? (
              <Notice kind="info" className="no-print">
                <p className="small">{t('account.changePhoneNote', language)}</p>
              </Notice>
            ) : null}
          </div>

          <Button variant="ghost" className={styles.blockButton} onClick={onSignOut}>
            {t('account.signOut', language)}
          </Button>
        </div>
      </section>
    </div>
  );
}
