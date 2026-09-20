'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { Wordmark } from '@/components/brand/Wordmark';
import { IconSearch } from '@/components/ui/icons';
import { useFarmerSession } from '@/lib/farmer-session';
import { CATEGORY_KEY } from '@/lib/farmers/listings';
import { LISTING_CATEGORIES, listingsForFarmer } from '@/lib/fixtures/farmers';
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
  const { farmer, language, setLanguage } = useFarmerSession();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const listingCount = farmer ? listingsForFarmer(farmer.id).length : 0;

  function onSearch(event: React.FormEvent) {
    event.preventDefault();
    const q = query.trim();
    router.push(q ? `/market?q=${encodeURIComponent(q)}` : '/market');
  }

  return (
    <header className={styles.shopMast}>
      <div className={styles.shopBar}>
        <Wordmark href={farmer ? '/farmer/account' : '/market'} size={22} onBand />

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

        <div className={styles.shopTools}>
          <div className={styles.shopLang}>
            <LanguageButtons value={language} onChange={setLanguage} />
          </div>

          <Link
            href={farmer ? '/farmer/account' : '/farmer/login'}
            className={styles.shopAcct}
            dir="auto"
          >
            <span className={styles.shopAcctLine1}>
              {farmer ? t('shell.greeting', language) : t('login.title', language)}
              {farmer ? ` ${farmer.given_name}` : ''}
            </span>
            <span className={styles.shopAcctLine2}>{t('account.title', language)}</span>
          </Link>

          <Link href="/farmer/account/listings" className={styles.shopCart}>
            <span className={styles.shopCartBadge}>{listingCount}</span>
            <span className={styles.shopCartLabel}>{t('account.tabListings', language)}</span>
          </Link>
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
