'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { Wordmark } from '@/components/brand/Wordmark';
import { Skeleton } from '@/components/ui';
import { useFarmerSession } from '@/lib/farmer-session';
import { t, type TKey } from '@/lib/i18n';

import { ShopMasthead } from './ShopMasthead';
import styles from './farmer.module.css';

/**
 * What a signed-in farmer can do, in the order they do it: Home, browse the
 * marketplace, post produce, manage their listings, learn, see their farm,
 * manage the account. "Post" is the existing listing form, made a first-class
 * door rather than a button inside My listings.
 */
const TABS: ReadonlyArray<{ href: string; key: TKey; exact?: boolean }> = [
  { href: '/farmer/account', key: 'account.tabOverview', exact: true },
  { href: '/market', key: 'shell.marketplace' },
  { href: '/farmer/account/listings/new', key: 'account.tabPost', exact: true },
  { href: '/farmer/account/listings', key: 'account.tabListings' },
  { href: '/farmer/account/learn', key: 'account.tabLearn' },
  { href: '/farmer/account/farm', key: 'account.tabFarm' },
  { href: '/farmer/account/settings', key: 'account.tabAccount' },
];

const BOTTOM: ReadonlyArray<{ href: string; key: TKey; exact?: boolean; glyph: ReactNode }> = [
  {
    href: '/farmer/account',
    key: 'account.tabOverview',
    exact: true,
    glyph: (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M4 11l8-7 8 7v9H4z" />
      </svg>
    ),
  },
  {
    href: '/market',
    key: 'shell.marketplace',
    glyph: (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18" />
      </svg>
    ),
  },
  {
    href: '/farmer/account/listings/new',
    key: 'account.tabPost',
    exact: true,
    glyph: (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    ),
  },
  {
    href: '/farmer/account/learn',
    key: 'account.tabLearn',
    glyph: (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M4 5h6a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H4zM20 5h-6a3 3 0 0 0-3 3v11a2 2 0 0 1 2-2h7z" />
      </svg>
    ),
  },
  {
    href: '/farmer/account/settings',
    key: 'account.tabAccount',
    glyph: (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    ),
  },
];

/**
 * The signed-in workspace shell: a sticky forest masthead carrying the
 * wordmark, the tabs (Home · Marketplace · Post · My listings · Learn · My farm · Account) and, at
 * the end, the farmer's name with their verification stamp; the content well
 * on the portal's 12-column measure; a footer with the wordmark, the tagline
 * and the year. Without a session it sends the visitor to sign in.
 */
export function AccountShell({ children }: { children: ReactNode }) {
  const { hydrated, language, farmer } = useFarmerSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (hydrated && !farmer) router.replace('/farmer/login');
  }, [hydrated, farmer, router]);

  return (
    <div className={styles.account}>
      <ShopMasthead
        subnav={
          <nav className={styles.shopStripNav} aria-label={t('account.title', language)}>
            {TABS.map((tab) => {
              // "My listings" must not light up while "Post" (its child path) is the page.
              const active = tab.exact
                ? pathname === tab.href
                : pathname.startsWith(tab.href) &&
                  !(
                    tab.href === '/farmer/account/listings' &&
                    pathname === '/farmer/account/listings/new'
                  );
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={styles.shopStripLink}
                  aria-current={active ? 'page' : undefined}
                >
                  {t(tab.key, language)}
                </Link>
              );
            })}
          </nav>
        }
      />

      <main id="farmer-main" className={styles.main} tabIndex={-1}>
        {farmer ? children : <WorkspaceSkeleton />}
      </main>

      {/* Phones: the five doors a farmer uses most, thumb-reachable. Desktop keeps the strip. */}
      <nav className={styles.bottomBar} aria-label={t('account.title', language)}>
        {BOTTOM.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={styles.bottomBarItem}
              aria-current={active ? 'page' : undefined}
            >
              <span className={styles.bottomBarGlyph} aria-hidden>
                {tab.glyph}
              </span>
              <span>{t(tab.key, language)}</span>
            </Link>
          );
        })}
      </nav>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <Wordmark size={18} tagline taglineText={t('brand.tagline', language)} />
          <span>{t('brand.copyright', language)}</span>
        </div>
      </footer>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className={styles.block} aria-busy>
      <Skeleton width="40%" height={36} />
      <Skeleton width="60%" height={16} />
      <Skeleton height={120} />
    </div>
  );
}

/** The ruled head every workspace page opens with. */
export function PageHead({
  title,
  lead,
  actions,
}: {
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.pageHead}>
      <div className={styles.pageTitle}>
        <h1>{title}</h1>
        {lead ? <p className={styles.pageLead}>{lead}</p> : null}
      </div>
      {actions ? <div className={styles.pageActions}>{actions}</div> : null}
    </div>
  );
}
