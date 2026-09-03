'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { Boundary } from '@/components/farmers/Boundary';
import { ButtonLink, Stamp } from '@/components/ui';
import {
  farmerPayamName,
  type Farm,
  type Farmer,
  type ProduceListing,
} from '@/lib/fixtures/farmers';
import {
  CATEGORY_KEY,
  STATUS_KEY,
  UNIT_KEY,
  formatQuantity,
  formatSsp,
  listingStamp,
} from '@/lib/farmers/listings';
import { VERIFICATION_KEY, verificationStamp } from '@/lib/farmers/verification';
import { formatDate, formatPhone } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';

import { Photo } from './Photo';
import styles from './listings.module.css';

/**
 * The product page, shared by the marketplace and the farmer's own preview:
 * gallery (cover first, up to five), title, price per unit, quantity,
 * description, availability, pickup and delivery, and the seller card with
 * verification stamp, payam, contact phone, listing count and a plot outline.
 * "Contact seller" is a call or an SMS — there is no chat.
 */
export function ProductPage({
  listing,
  seller,
  sellerListingCount,
  farm,
  lang,
  photos,
  kicker,
  actions,
}: {
  listing: ProduceListing;
  seller: Farmer;
  sellerListingCount: number;
  farm?: Farm;
  lang: Language;
  /** Local object URLs standing in for the storage paths (the form's preview). */
  photos?: string[];
  kicker?: ReactNode;
  actions?: ReactNode;
}) {
  const sources: Array<string | null> =
    photos && photos.length > 0
      ? photos
      : listing.photo_storage_paths.length > 0
        ? listing.photo_storage_paths
        : [null];
  const [index, setIndex] = useState(0);
  const current = sources[Math.min(index, sources.length - 1)] ?? null;
  const unit = (u: ProduceListing['unit']) => t(UNIT_KEY[u], lang);
  const phone = listing.contact_phone;

  return (
    <div className={styles.product}>
      <div className={styles.gallery}>
        <Photo
          src={current}
          category={listing.category}
          lang={lang}
          alt={listing.title}
          note={
            sources.length > 1
              ? `${t('detail.photoOf', lang)} ${index + 1} ${t('detail.of', lang)} ${sources.length}`
              : undefined
          }
        />
        {sources.length > 1 ? (
          <div className={styles.thumbs} role="list">
            {sources.map((src, i) => (
              <button
                key={i}
                type="button"
                role="listitem"
                className={styles.thumb}
                aria-current={i === index}
                aria-label={`${t('detail.photoOf', lang)} ${i + 1}`}
                onClick={() => setIndex(i)}
              >
                <Photo src={src} category={listing.category} lang={lang} />
              </button>
            ))}
          </div>
        ) : null}
        <section className={styles.productSection}>
          <h2>{t('detail.description', lang)}</h2>
          <p className={styles.prose} dir="auto">
            {listing.description}
          </p>
        </section>
      </div>

      <div>
        {kicker}
        <header className={styles.productHead}>
          <div className={styles.productKicker}>
            <span>{t(CATEGORY_KEY[listing.category], lang)}</span>
            <span aria-hidden>·</span>
            <span dir="auto">{listing.product_name}</span>
            <Stamp kind={listingStamp(listing.status)}>{t(STATUS_KEY[listing.status], lang)}</Stamp>
          </div>
          <h1 className={styles.productTitle} dir="auto">
            {listing.title}
          </h1>
          <div className={styles.productPrice}>
            <span>{formatSsp(listing.price_ssp)}</span>
            <small>/ {unit(listing.price_per)}</small>
            {listing.negotiable ? <small>· {t('listings.negotiable', lang)}</small> : null}
          </div>
          {actions}
        </header>

        <dl className={styles.productFacts}>
          <Fact term={t('detail.quantity', lang)}>{formatQuantity(listing, unit)}</Fact>
          <Fact term={t('detail.location', lang)}>{farmerPayamName(seller.payam_id)}</Fact>
          <Fact term={t('detail.availability', lang)}>
            <span className={styles.mono}>
              {formatDate(listing.available_from)}
              {' – '}
              {listing.available_until
                ? formatDate(listing.available_until)
                : t('listings.ongoing', lang)}
            </span>
          </Fact>
          <Fact term={t('detail.delivery', lang)}>
            {listing.delivery_available
              ? t('listings.delivery', lang)
              : t('listings.noDelivery', lang)}
          </Fact>
          {listing.harvest_season ? (
            <Fact term={t('detail.season', lang)}>{listing.harvest_season}</Fact>
          ) : null}
          {listing.pickup_notes ? (
            <Fact term={t('detail.pickup', lang)}>
              <span dir="auto">{listing.pickup_notes}</span>
            </Fact>
          ) : null}
          <Fact term={t('detail.updatedOn', lang)}>
            <span className={styles.mono}>{formatDate(listing.updated_at)}</span>
          </Fact>
        </dl>

        <section className={styles.productSection}>
          <h2 className={styles.sellerTitle}>{t('detail.seller', lang)}</h2>
          <div className={styles.seller}>
            <div className={styles.sellerHead}>
              <div>
                <div className={styles.sellerName} dir="auto">
                  {seller.given_name} {seller.family_name}
                </div>
                <Stamp kind={verificationStamp(seller.verification_status)}>
                  {t(VERIFICATION_KEY[seller.verification_status], lang)}
                </Stamp>
              </div>
              {farm ? <Boundary farm={farm} size={96} /> : null}
            </div>
            <dl className={styles.sellerRows}>
              <div className={styles.sellerRow}>
                <dt>{t('account.payam', lang)}</dt>
                <dd>{farmerPayamName(seller.payam_id)}</dd>
              </div>
              <div className={styles.sellerRow}>
                <dt>{t('account.phone', lang)}</dt>
                <dd className={styles.mono}>{formatPhone(phone)}</dd>
              </div>
              <div className={styles.sellerRow}>
                <dt>{t('listings.title', lang)}</dt>
                <dd className={styles.mono}>
                  {sellerListingCount} {t('detail.sellerListings', lang)}
                </dd>
              </div>
            </dl>
            <div className={styles.sellerContact}>
              <ButtonLink href={`tel:${phone}`} variant="primary">
                {t('detail.call', lang)}
              </ButtonLink>
              <ButtonLink href={`sms:${phone}`} variant="secondary">
                {t('detail.sms', lang)}
              </ButtonLink>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className={styles.productFact}>
      <dt className={styles.cardCategory}>{term}</dt>
      <dd className={styles.productFactValue}>{children}</dd>
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="small">
      <Link href={href}>← {children}</Link>
    </p>
  );
}
