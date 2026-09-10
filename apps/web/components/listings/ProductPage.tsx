'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';

import { Button, ButtonLink, Stamp } from '@/components/ui';
import { IconChevronLeft, IconChevronRight } from '@/components/ui/icons';
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
  listingCover,
  listingStamp,
} from '@/lib/farmers/listings';
import { VERIFICATION_KEY, verificationStamp } from '@/lib/farmers/verification';
import { formatDate, formatPhone } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';

import { Photo } from './Photo';
import styles from './listings.module.css';

/** Two initials for the seller disc — never an icon alone. */
function initials(seller: Farmer): string {
  return `${seller.given_name[0] ?? ''}${seller.family_name[0] ?? ''}`.toUpperCase();
}

/**
 * The product page, shared by the marketplace and the farmer's own preview: a
 * gallery with a keyboard-navigable thumbnail strip on the left, and a sticky
 * buy panel on the right — title, price per unit, the quantity and availability
 * lines, call and SMS, and the seller card. Below, the full-width description,
 * a details table with mono values, and any "more from this seller" or
 * "similar" rows. A sticky price-and-call bar appears on narrow screens.
 * "Contact seller" is a call or an SMS — there is no chat.
 */
export function ProductPage({
  listing,
  seller,
  sellerListingCount,
  lang,
  photos,
  breadcrumb,
  kicker,
  actions,
  moderate,
  related,
  sellerListingsHref,
}: {
  listing: ProduceListing;
  seller: Farmer;
  sellerListingCount: number;
  /** Accepted for the farmer preview's call sites; the map lives on /farm now. */
  farm?: Farm;
  lang: Language;
  /** Local object URLs standing in for the storage paths (the form's preview). */
  photos?: string[];
  breadcrumb?: ReactNode;
  kicker?: ReactNode;
  actions?: ReactNode;
  moderate?: ReactNode;
  related?: ReactNode;
  sellerListingsHref?: string;
}) {
  const sources: Array<string | null> =
    photos && photos.length > 0 ? photos : [listingCover(listing)];
  const [index, setIndex] = useState(0);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = sources[Math.min(index, sources.length - 1)] ?? null;
  const unit = (u: ProduceListing['unit']) => t(UNIT_KEY[u], lang);
  const phone = listing.contact_phone;

  function step(delta: number, focus = false) {
    setIndex((i) => {
      const next = Math.min(Math.max(i + delta, 0), sources.length - 1);
      if (focus) thumbRefs.current[next]?.focus();
      return next;
    });
  }

  const availability = (
    <span className={styles.mono}>
      {formatDate(listing.available_from)}
      {' – '}
      {listing.available_until ? formatDate(listing.available_until) : t('listings.ongoing', lang)}
    </span>
  );

  return (
    <>
      {breadcrumb}
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
            <div
              className={styles.thumbs}
              role="group"
              aria-label={t('detail.photos', lang)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  step(1, true);
                } else if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  step(-1, true);
                }
              }}
            >
              <Button
                variant="ghost"
                size="small"
                iconOnly
                aria-label={t('detail.prevPhoto', lang)}
                disabled={index === 0}
                onClick={() => step(-1)}
              >
                <IconChevronLeft size={18} />
              </Button>
              {sources.map((src, i) => (
                <button
                  key={i}
                  type="button"
                  ref={(el) => {
                    thumbRefs.current[i] = el;
                  }}
                  className={styles.thumb}
                  aria-current={i === index}
                  tabIndex={i === index ? 0 : -1}
                  aria-label={`${t('detail.photoOf', lang)} ${i + 1}`}
                  onClick={() => setIndex(i)}
                >
                  <Photo src={src} category={listing.category} lang={lang} />
                </button>
              ))}
              <Button
                variant="ghost"
                size="small"
                iconOnly
                aria-label={t('detail.nextPhoto', lang)}
                disabled={index === sources.length - 1}
                onClick={() => step(1)}
              >
                <IconChevronRight size={18} />
              </Button>
            </div>
          ) : null}
        </div>

        <div className={styles.panel}>
          {kicker}
          <header className={styles.productHead}>
            <div className={styles.productKicker}>
              <span>{t(CATEGORY_KEY[listing.category], lang)}</span>
              <span aria-hidden>·</span>
              <span dir="auto">{listing.product_name}</span>
              <Stamp kind={listingStamp(listing.status)}>
                {t(STATUS_KEY[listing.status], lang)}
              </Stamp>
            </div>
            <h1 className={styles.productTitle} dir="auto">
              {listing.title}
            </h1>
            <div className={styles.productPrice}>
              <span>{formatSsp(listing.price_ssp)}</span>
              <small>/ {unit(listing.price_per)}</small>
              {listing.negotiable ? (
                <span className={styles.negChip}>{t('market.negotiable', lang)}</span>
              ) : null}
            </div>
          </header>

          <div className={styles.buyLine}>
            <span>{t('detail.quantity', lang)}</span>
            <span className={styles.mono}>{formatQuantity(listing, unit)}</span>
          </div>
          <div className={styles.buyLine}>
            <span>{t('detail.availability', lang)}</span>
            {availability}
          </div>
          <div className={styles.buyLine}>
            <span>{t('detail.delivery', lang)}</span>
            <span>
              {listing.delivery_available
                ? t('listings.delivery', lang)
                : t('listings.noDelivery', lang)}
            </span>
          </div>

          <div className={styles.contact}>
            <ButtonLink href={`tel:${phone}`} variant="primary">
              {t('detail.call', lang)}
            </ButtonLink>
            <ButtonLink href={`sms:${phone}`} variant="secondary">
              {t('detail.sms', lang)}
            </ButtonLink>
          </div>

          <div className={styles.seller}>
            <div className={styles.sellerHead}>
              <span className={styles.sellerDisc} aria-hidden>
                {initials(seller)}
              </span>
              <div>
                <div className={styles.sellerName} dir="auto">
                  {seller.given_name} {seller.family_name}
                </div>
                <Stamp kind={verificationStamp(seller.verification_status)}>
                  {t(VERIFICATION_KEY[seller.verification_status], lang)}
                </Stamp>
              </div>
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
                <dt>{t('market.memberSince', lang)}</dt>
                <dd className={styles.mono}>{formatDate(seller.created_at)}</dd>
              </div>
              <div className={styles.sellerRow}>
                <dt>{t('detail.listings', lang)}</dt>
                <dd className={styles.mono}>
                  {sellerListingCount} {t('detail.sellerListings', lang)}
                </dd>
              </div>
            </dl>
            {sellerListingsHref ? (
              <Link href={sellerListingsHref} className={styles.sellerLink}>
                {t('market.viewSellerListings', lang)}
              </Link>
            ) : null}
          </div>

          {actions}
          {moderate}
        </div>
      </div>

      <section className={styles.productSection}>
        <h2>{t('detail.description', lang)}</h2>
        <p className={styles.prose} dir="auto">
          {listing.description}
        </p>
      </section>

      <section className={styles.productSection}>
        <h2>{t('detail.details', lang)}</h2>
        <table className={styles.detailTable}>
          <tbody>
            <DetailRow term={t('detail.category', lang)}>
              {t(CATEGORY_KEY[listing.category], lang)}
            </DetailRow>
            <DetailRow term={t('detail.quantity', lang)}>{formatQuantity(listing, unit)}</DetailRow>
            <DetailRow term={t('market.unit', lang)}>{unit(listing.unit)}</DetailRow>
            <DetailRow term={t('detail.season', lang)}>
              {listing.harvest_season || t('listings.ongoing', lang)}
            </DetailRow>
            <DetailRow term={t('detail.pickup', lang)}>{listing.pickup_notes || '—'}</DetailRow>
            <DetailRow term={t('detail.listedOn', lang)}>
              {formatDate(listing.created_at)}
            </DetailRow>
            <DetailRow term={t('market.listingNo', lang)}>
              {listing.id.slice(-8).toUpperCase()}
            </DetailRow>
          </tbody>
        </table>
      </section>

      {related}

      <div className={styles.stickyBar}>
        <span className={styles.mono}>
          {formatSsp(listing.price_ssp)} <span className="small">/ {unit(listing.price_per)}</span>
        </span>
        <ButtonLink href={`tel:${phone}`} variant="primary">
          {t('detail.call', lang)}
        </ButtonLink>
      </div>
    </>
  );
}

function DetailRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <tr>
      <th scope="row">{term}</th>
      <td dir="auto">{children}</td>
    </tr>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="small">
      <Link href={href}>← {children}</Link>
    </p>
  );
}
