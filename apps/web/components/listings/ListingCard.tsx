import Link from 'next/link';
import type { ReactNode } from 'react';

import { ButtonLink, Stamp } from '@/components/ui';
import { farmerPayamName, type Farmer, type ProduceListing } from '@/lib/fixtures/farmers';
import {
  CATEGORY_KEY,
  STATUS_KEY,
  UNIT_KEY,
  formatQuantity,
  formatSsp,
  listingCover,
  listingStamp,
} from '@/lib/farmers/listings';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';
import { verificationStamp, VERIFICATION_KEY } from '@/lib/farmers/verification';

import { CategoryGlyph } from './CategoryGlyph';
import { Photo } from './Photo';
import styles from './listings.module.css';

/** Two initials for the seller disc — never an icon alone. */
function initials(seller: Farmer): string {
  return `${seller.given_name[0] ?? ''}${seller.family_name[0] ?? ''}`.toUpperCase();
}

/**
 * One product card. On the marketplace (a `seller` is given): a 4:3 cover with
 * a category badge and, when not listed, a status stamp; a Fraunces title, the
 * product and quantity, the price as the hero line, the seller with their
 * verification stamp and payam, and a "Contact seller" button revealed on
 * hover or shown on touch. On the farmer's own list (no seller): the same head
 * with the status stamp and an Edit action in the foot. Staff get a kebab that
 * opens moderation. The whole card links to the product page.
 */
export function ListingCard({
  listing,
  href,
  lang,
  seller,
  showStatus = false,
  actions,
  onModerate,
}: {
  listing: ProduceListing;
  href: string;
  lang: Language;
  seller?: Farmer;
  showStatus?: boolean;
  actions?: ReactNode;
  onModerate?: (listing: ProduceListing) => void;
}) {
  const unit = (u: ProduceListing['unit']) => t(UNIT_KEY[u], lang);
  const photos = listing.photo_storage_paths.length;
  const stampVisible = showStatus || (seller && listing.status !== 'listed');

  return (
    <article className={styles.card}>
      <div className={styles.cover}>
        <Photo
          src={listingCover(listing)}
          category={listing.category}
          lang={lang}
          alt={listing.title}
          note={photos > 1 ? `${photos} ${t('listings.photos', lang)}` : undefined}
        />
        <span className={styles.badge}>
          <CategoryGlyph category={listing.category} size={14} />
          {t(CATEGORY_KEY[listing.category], lang)}
        </span>
        {stampVisible || onModerate ? (
          <span className={styles.frameTopRight}>
            {stampVisible ? (
              <Stamp kind={listingStamp(listing.status)}>
                {t(STATUS_KEY[listing.status], lang)}
              </Stamp>
            ) : null}
            {onModerate ? (
              <details className={styles.kebab}>
                <summary aria-label={t('market.moderate', lang)}>⋮</summary>
                <div className={styles.kebabMenu}>
                  <button
                    type="button"
                    className={styles.kebabItem}
                    onClick={() => onModerate(listing)}
                  >
                    {t('market.moderateListing', lang)}
                  </button>
                </div>
              </details>
            ) : null}
          </span>
        ) : null}
      </div>

      <div className={styles.cardBody}>
        <Link href={href} className={styles.cardTitle} dir="auto">
          {listing.title}
        </Link>
        <span className={styles.cardProduct} dir="auto">
          {listing.product_name} · {formatQuantity(listing, unit)}
        </span>
        <div className={styles.cardPrice}>
          {formatSsp(listing.price_ssp)} <small>/ {unit(listing.price_per)}</small>
        </div>
      </div>

      {seller ? (
        <>
          <div className={styles.cardSellerRow}>
            <span className={styles.disc} aria-hidden>
              {initials(seller)}
            </span>
            <span className={styles.cardSellerName} dir="auto">
              {seller.given_name} {seller.family_name}
            </span>
            <Stamp kind={verificationStamp(seller.verification_status)}>
              {t(VERIFICATION_KEY[seller.verification_status], lang)}
            </Stamp>
            <span className={styles.cardSellerPayam}>{farmerPayamName(seller.payam_id)}</span>
          </div>
          <div className={styles.cardContact}>
            <ButtonLink href={href} variant="secondary" size="small">
              {t('market.contact', lang)}
            </ButtonLink>
          </div>
        </>
      ) : (
        <div className={styles.cardFoot}>
          <span className={styles.mono}>{formatDate(listing.updated_at)}</span>
          <span className={styles.cardActions}>{actions}</span>
        </div>
      )}
    </article>
  );
}
