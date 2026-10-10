'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { Wordmark } from '@/components/brand/Wordmark';
import { IconSearch } from '@/components/ui/icons';
import { useFarmerSession } from '@/lib/farmer-session';
import { useUnreadNotifications } from '@/lib/farmer-unread';
import { CATEGORY_KEY } from '@/lib/farmers/listings';
import { LISTING_CATEGORIES } from '@/lib/fixtures/farmers';
import { t } from '@/lib/i18n';

import { LanguageButtons } from './LanguageSwitch';
import styles from './farmer.module.css';

/**
 * The Amazon-style shopping masthead for the farmer + marketplace surfaces: a
 * full-width dark-green bar with the wordmark, one big rounded search pill (an
 * "all categories" segment, the field, and a green magnifier button), the
 * language switch and a two-line account block, and — as the cart analog — a
 * "Your listings" link with a count badge; beneath it a lighter-green strip
 * carrying the passed sub-navigation (category links or the account tabs).
 * The masthead search navigates to the marketplace, where the in-page search
 * band does the filtering; it changes chrome only, never data.
 */
export function ShopMasthead({ subnav, hideStrip }: { subnav?: ReactNode; hideStrip?: boolean }) {
  const { farmer, language, setLanguage, listingsFor } = useFarmerSession();
  const unread = useUnreadNotifications(Boolean(farmer));
  const router = useRouter();
  const [query, setQuery] = useState('');
  // The search belongs to the marketplace only (the owner, 2026-10-08): on the
  // farmer's own dashboard pages it is noise. /market and /market/<id> keep it.
  const pathname = usePathname() ?? '';
  const showSearch = pathname === '/market' || pathname.startsWith('/market/');
  const listingCount = farmer ? listingsFor(farmer.id).length : 0;

  function onSearch(event: React.FormEvent) {
    event.preventDefault();
    const q = query.trim();
    router.push(q ? `/market?q=${encodeURIComponent(q)}` : '/market');
  }

  return (
    <header className={styles.shopMast}>
      <div className={styles.shopBar}>
        <Wordmark href={farmer ? '/farmer/account' : '/market'} size={22} onBand />

        {showSearch ? (
          <form role="search" className={styles.shopSearch} onSubmit={onSearch}>
            <span className={styles.shopSearchScope} aria-hidden>
              {t('market.allCategories', language)}
            </span>
            <input
              type="search"
              className={styles.shopSearchField}
              placeholder={t('market.search', language)}
              aria-label={t('market.search', language)}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button
              type="submit"
              className={styles.shopSearchBtn}
              aria-label={t('market.search', language)}
            >
              <IconSearch />
            </button>
          </form>
        ) : (
          <div style={{ flex: 1 }} aria-hidden />
        )}

        <div className={styles.shopTools}>
          <div className={styles.shopLang}>
            <LanguageButtons value={language} onChange={setLanguage} />
          </div>

          <Link
            href={farmer ? '/farmer/account' : '/join'}
            className={farmer ? `${styles.shopAcct} ${styles.shopAcctSignedIn}` : styles.shopAcct}
            dir="auto"
          >
            <span className={styles.shopAcctLine1}>
              {farmer ? t('shell.greeting', language) : t('login.title', language)}
              {farmer ? ` ${farmer.given_name}` : ''}
            </span>
            <span className={styles.shopAcctLine2}>
              {farmer ? t('account.title', language) : t('shell.joinLine2', language)}
            </span>
          </Link>

          {farmer ? (
            <Link
              href="/farmer/account/notifications"
              className={styles.shopBell}
              aria-label={
                unread > 0
                  ? `${t('notifications.title', language)} (${unread})`
                  : t('notifications.title', language)
              }
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unread > 0 ? (
                <span className={styles.bellBadge}>{unread > 99 ? '99+' : unread}</span>
              ) : null}
            </Link>
          ) : null}

          {farmer ? (
            <Link
              href="/farmer/account/listings"
              className={styles.shopCart}
              aria-label={`${t('account.tabListings', language)} (${listingCount})`}
            >
              <span className={styles.shopCartBadge}>{listingCount}</span>
              <span className={styles.shopCartLabel}>{t('account.tabListings', language)}</span>
            </Link>
          ) : (
            // A visitor's cart is a buyer's: signing in as a buyer is required.
            <Link href="/buyer/cart" className={styles.shopCart}>
              <span className={styles.shopCartLabel}>{t('shell.buyerCart', language)}</span>
            </Link>
          )}
        </div>
      </div>

      {hideStrip ? null : (
        <div className={styles.shopStrip}>
          <span className={styles.shopStripAll} aria-hidden>
            <span className={styles.shopBurger} />
            {t('market.allCategories', language)}
          </span>
          {subnav ?? <ShopCategoryLinks />}
        </div>
      )}
    </header>
  );
}

/** The horizontal category links on the second strip — they open the marketplace. */
export function ShopCategoryLinks() {
  const { language } = useFarmerSession();
  return (
    <nav className={styles.shopStripNav} aria-label={t('market.allCategories', language)}>
      {LISTING_CATEGORIES.filter((category) => category !== 'other').map((category) => (
        <Link key={category} href="/market" className={styles.shopStripLink}>
          {t(CATEGORY_KEY[category], language)}
        </Link>
      ))}
    </nav>
  );
}
