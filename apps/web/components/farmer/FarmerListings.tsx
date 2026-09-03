'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { ButtonLink, EmptyState, Stamp } from '@/components/ui';
import { listingStamp, STATUS_KEY } from '@/lib/farmers/listings';
import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';
import { CROP_LABELS, formatDate } from '@/lib/format';

import styles from './farmer.module.css';

/** The farmer's own produce, newest change first, each row a link to edit it. */
export function FarmerListings() {
  const { hydrated, farmer, language, listingsFor } = useFarmerSession();
  const router = useRouter();

  useEffect(() => {
    if (hydrated && !farmer) router.replace('/farmer/login');
  }, [hydrated, farmer, router]);

  if (!hydrated || !farmer) return null;

  const listings = listingsFor(farmer.id);

  return (
    <div className={styles.sheet}>
      <div className={styles.sectionHead}>
        <h1 className={styles.h1} style={{ marginBlockEnd: 0 }}>
          {t('listings.title', language)}
        </h1>
        <Stamp
          kind={
            farmer.verification_status === 'verified'
              ? 'verified'
              : farmer.verification_status === 'rejected'
                ? 'rejected'
                : 'pending'
          }
        >
          {t(
            farmer.verification_status === 'verified'
              ? 'account.verified'
              : farmer.verification_status === 'rejected'
                ? 'account.rejected'
                : 'account.pending',
            language,
          )}
        </Stamp>
      </div>

      <div className={styles.actions} style={{ marginBlockStart: 0, marginBlockEnd: 'var(--s-5)' }}>
        <ButtonLink
          href="/farmer/account/listings/new"
          variant="primary"
          className={styles.blockButton}
        >
          {t('listings.new', language)}
        </ButtonLink>
      </div>

      {listings.length === 0 ? (
        <EmptyState
          title={t('listings.empty', language)}
          body={t('account.whatPendingBody', language)}
          actions={
            <ButtonLink href="/farmer/account/listings/new" variant="secondary">
              {t('listings.emptyAction', language)}
            </ButtonLink>
          }
        />
      ) : (
        <div className={styles.listingList}>
          {listings.map((l) => (
            <Link
              key={l.id}
              href={`/farmer/account/listings/${l.id}`}
              className={styles.listingRow}
            >
              <div className={styles.listingTop}>
                <span className={styles.listingCrop}>{CROP_LABELS[l.crop]}</span>
                <Stamp kind={listingStamp(l.status)}>{t(STATUS_KEY[l.status], language)}</Stamp>
              </div>
              <div className={styles.listingFigures}>
                {l.quantity_kg} {t('listings.kg', language)}
                {l.price_ssp_per_kg !== null ? (
                  <>
                    {' '}
                    · {l.price_ssp_per_kg} {t('listings.perKg', language)}
                  </>
                ) : (
                  <> · {t('listings.noPrice', language)}</>
                )}
              </div>
              <div className={styles.listingWindow}>
                {t('listings.from', language)} {formatDate(l.available_from)}
                {l.available_until
                  ? ` · ${t('listings.until', language)} ${formatDate(l.available_until)}`
                  : ` · ${t('listings.ongoing', language)}`}
              </div>
            </Link>
          ))}
        </div>
      )}

      <p className={styles.linkRow}>
        <Link href="/farmer/account">← {t('account.title', language)}</Link>
      </p>
    </div>
  );
}
