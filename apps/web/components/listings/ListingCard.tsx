import Link from 'next/link';
import type { ReactNode } from 'react';

import { Stamp } from '@/components/ui';
import { farmerPayamName, type Farmer, type ProduceListing } from '@/lib/fixtures/farmers';
import {
  CATEGORY_KEY,
  STATUS_KEY,
  UNIT_KEY,
  coverOf,
  formatQuantity,
  formatSsp,
  listingStamp,
} from '@/lib/farmers/listings';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';
import { verificationStamp, VERIFICATION_KEY } from '@/lib/farmers/verification';

import { Photo } from './Photo';
import styles from './listings.module.css';

/**
 * One product card: cover photo, category, title, price per unit in mono,
 * quantity, then either the seller (marketplace) or the status stamp and edit
 * action (the farmer's own list). The whole card is the link; actions sit
 * above it.
 */
export function ListingCard({
  listing,
  href,
  lang,
  seller,
  showStatus = false,
  actions,
}: {
  listing: ProduceListing;
  href: string;
  lang: Language;
  seller?: Farmer;
  showStatus?: boolean;
  actions?: ReactNode;
}) {
  const unit = (u: ProduceListing['unit']) => t(UNIT_KEY[u], lang);
  const photos = listing.photo_storage_paths.length;
  return (
    <article className={styles.card}>
      <Photo
        src={coverOf(listing)}
        category={listing.category}
        lang={lang}
        note={photos > 1 ? `${photos} ${t('listings.photos', lang)}` : undefined}
      />
      <div className={styles.cardBody}>
        <div className={styles.cardTop}>
          <span className={styles.cardCategory}>{t(CATEGORY_KEY[listing.category], lang)}</span>
          {showStatus ? (
            <Stamp kind={listingStamp(listing.status)}>{t(STATUS_KEY[listing.status], lang)}</Stamp>
          ) : null}
        </div>
        <Link href={href} className={styles.cardTitle} dir="auto">
          {listing.title}
        </Link>
        <div className={styles.cardPrice}>
          {formatSsp(listing.price_ssp)} <small>/ {unit(listing.price_per)}</small>
        </div>
        <div className={styles.cardMeta}>
          <span>{formatQuantity(listing, unit)}</span>
          {listing.negotiable ? <span>{t('listings.negotiable', lang)}</span> : null}
        </div>
      </div>
      <div className={styles.cardFoot}>
        {seller ? (
          <span className={styles.cardSeller}>
            <span className={styles.cardSellerName} dir="auto">
              {seller.given_name} {seller.family_name}
            </span>
            <Stamp kind={verificationStamp(seller.verification_status)}>
              {t(VERIFICATION_KEY[seller.verification_status], lang)}
            </Stamp>
          </span>
        ) : (
          <span className={styles.mono}>{formatDate(listing.updated_at)}</span>
        )}
        <span className={styles.cardActions}>
          {actions ?? (seller ? <span>{farmerPayamName(seller.payam_id)}</span> : null)}
        </span>
      </div>
    </article>
  );
}
