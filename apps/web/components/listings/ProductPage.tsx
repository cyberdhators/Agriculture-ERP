'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';

import { ProfileLink } from '@/components/profiles/PublicProfile';
import { Button, ButtonLink, Stamp } from '@/components/ui';
import { DirArrow, IconChevronLeft, IconChevronRight } from '@/components/ui/icons';
import type { ProduceListing } from '@/lib/fixtures/farmers';
import type { SellerInfo } from '@/lib/listings/api-client';
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

import { Photo } from './Photo';
import styles from './listings.module.css';

/** Two initials for the seller disc — never an icon alone. */
function initials(seller: Pick<ProduceListing, 'trading_name'>): string {
  const words = seller.trading_name.trim().split(/\s+/);
  return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
}

/**
 * The product page, shared by the marketplace and the farmer's own preview: a
 * gallery with a keyboard-navigable thumbnail strip on the left, and a sticky
 * buy panel on the right — title, price per unit, the quantity and availability
 * lines, call and SMS, and the seller card. Below, the full-width description,
 * a details table with mono values, and any "more from this seller" or
 * "similar" rows. A sticky price-and-call bar appears on narrow screens.
 * B14: "Buy" sends a visitor to the BUYER's product page, which needs a buyer
 * sign-in (the owner: "buyer should be signed in before sending request or
 * adding to cart"). There the product goes into the cart and the request goes
 * to the farmer directly. The farmer's number is never on this public page.
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
  buy,
  sellerListingsHref,
  contact = true,
}: {
  listing: ProduceListing;
  seller: SellerInfo;
  sellerListingCount: number;
  lang: Language;
  /** Local object URLs standing in for the storage paths (the form's preview). */
  photos?: string[];
  breadcrumb?: ReactNode;
  kicker?: ReactNode;
  actions?: ReactNode;
  moderate?: ReactNode;
  related?: ReactNode;
  /**
   * 2026-10-31: the one Buy action. The market passes its BuyBox (it knows
   * buyer / farmer / visitor); without it the plain link to the buyer page
   * stands in. Only one is ever shown.
   */
  buy?: ReactNode;
  sellerListingsHref?: string;
  /** False on the farmer's own preview: a farmer does not contact themselves. */
  contact?: boolean;
}) {
  const sources: Array<string | null> =
    photos && photos.length > 0 ? photos : [listingCover(listing)];
  const [index, setIndex] = useState(0);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = sources[Math.min(index, sources.length - 1)] ?? null;
  const unit = (u: ProduceListing['unit']) => t(UNIT_KEY[u], lang);

  function step(delta: number, focus = false) {
    setIndex((i) => {
      const next = Math.min(Math.max(i + delta, 0), sources.length - 1);
      if (focus) thumbRefs.current[next]?.focus();
      return next;
    });
  }

  const availability = (
    <span className={styles.mono}>
      {formatDate(listing.available_from, lang)}
      {' – '}
      {listing.available_until
        ? formatDate(listing.available_until, lang)
        : t('listings.ongoing', lang)}
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
              {!contact || listing.status !== 'listed' ? (
                <Stamp kind={listingStamp(listing.status)}>
                  {t(STATUS_KEY[listing.status], lang)}
                </Stamp>
              ) : null}
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

          {/* 2026-10-31 (the owner: "i know you can do better"): the three
              facts a buyer weighs, as small tiles, said once on the page. */}
          <dl className={styles.facts}>
            <Fact icon={FACT_ICON.quantity} label={t('detail.quantity', lang)}>
              {formatQuantity(listing, unit)}
            </Fact>
            <Fact icon={FACT_ICON.when} label={t('detail.availability', lang)}>
              {availability}
            </Fact>
            <Fact icon={FACT_ICON.delivery} label={t('detail.delivery', lang)}>
              {listing.delivery_available
                ? t('listings.delivery', lang)
                : t('listings.noDelivery', lang)}
            </Fact>
          </dl>

          {contact ? (
            <div className={styles.buyBox}>
              {buy ?? (
                <ButtonLink variant="primary" href={`/buyer/marketplace/${listing.id}`}>
                  {t('contact.button', lang)}
                </ButtonLink>
              )}
              <p className={styles.buyNote}>
                <Link href="/buyer/register">{t('contact.registerBuyer', lang)}</Link>
              </p>
            </div>
          ) : null}

          <div className={styles.sellerCard}>
            <div className={styles.sellerHead}>
              <span className={styles.sellerDisc} aria-hidden>
                {initials(listing)}
              </span>
              <div className={styles.sellerText}>
                <div className={styles.sellerName} dir="auto">
                  {listing.trading_name}
                </div>
                <div className={styles.sellerMeta}>
                  <span>{seller.payam_name}</span>
                  <span>
                    {t('market.memberSince', lang)} {formatDate(seller.created_at, lang)}
                  </span>
                </div>
              </div>
            </div>
            {sellerListingsHref ? (
              <Link href={sellerListingsHref} className={styles.sellerLink}>
                {t('market.viewSellerListings', lang)} ({sellerListingCount})
              </Link>
            ) : null}
            {/* 2026-10-20: the seller's public profile. */}
            <ProfileLink kind="listing" id={listing.id} language={lang} />
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
            <DetailRow term={t('detail.season', lang)}>
              {listing.harvest_season || t('listings.ongoing', lang)}
            </DetailRow>
            {listing.pickup_notes ? (
              <DetailRow term={t('detail.pickup', lang)}>{listing.pickup_notes}</DetailRow>
            ) : null}
            <DetailRow term={t('detail.listedOn', lang)}>
              {formatDate(listing.created_at, lang)}
            </DetailRow>
            <DetailRow term={t('market.listingNo', lang)}>
              {listing.id.slice(-8).toUpperCase()}
            </DetailRow>
          </tbody>
        </table>
      </section>

      {related}

      {/* The pinned bar repeats the plain Buy link; where the market's own Buy
          (which knows who is looking) is on the page, it would say a different
          thing, so it is left out. */}
      {contact && !buy ? (
        <div className={styles.stickyBar}>
          <span className={styles.mono}>
            {formatSsp(listing.price_ssp)}{' '}
            <span className="small">/ {unit(listing.price_per)}</span>
          </span>
          <ButtonLink variant="primary" href={`/buyer/marketplace/${listing.id}`}>
            {t('contact.button', lang)}
          </ButtonLink>
        </div>
      ) : null}
    </>
  );
}

const FACT_ICON = {
  quantity: 'M4 8l8-4 8 4-8 4zM4 8v8l8 4 8-4V8M12 12v8',
  when: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  delivery: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01',
} as const;

function Fact({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <span className={styles.factIcon} aria-hidden>
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={icon} />
        </svg>
      </span>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>{children}</dd>
    </div>
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
      <Link href={href}>
        <DirArrow back /> {children}
      </Link>
    </p>
  );
}
