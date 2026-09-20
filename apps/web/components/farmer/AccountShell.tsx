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

/* ── Sidebar navigation ─────────────────────────────────────────────── */

interface NavItem {
  href: string;
  key: TKey;
  exact?: boolean;
  glyph: ReactNode;
}

interface NavGroup {
  label?: TKey;
  items: NavItem[];
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    items: [
      {
        href: '/farmer/account',
        key: 'account.tabOverview',
        exact: true,
        glyph: (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="4" rx="1" />
            <rect x="14" y="11" width="7" height="10" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'nav.myFarm',
    items: [
      {
        href: '/farmer/account/farm',
        key: 'account.tabFarm',
        glyph: (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 20V9l8-5 8 5v11" />
            <path d="M4 20h16M9 20v-6h6v6" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'nav.market',
    items: [
      {
        href: '/market',
        key: 'shell.marketplace',
        glyph: (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/listings/new',
        key: 'account.tilePost',
        exact: true,
        glyph: (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v8M8 12h8" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/listings',
        key: 'account.tabListings',
        glyph: (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18M8 13h8M8 16.5h5" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/prices',
        key: 'prices.title',
        glyph: (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 20V4l4 4 4-4 4 4 4-4v16H4z" />
            <path d="M8 12h8M8 16h5" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'nav.learnAndServices',
    items: [
      {
        href: '/farmer/account/learn',
        key: 'account.tabLearn',
        glyph: (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 5h6a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H4z" />
            <path d="M20 5h-6a3 3 0 0 0-3 3v11a2 2 0 0 1 2-2h7z" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/services',
        key: 'services.title',
        glyph: (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="10" r="3" />
            <path d="M12 13v3M4 21a8 8 0 0 1 16 0" />
            <path d="M16 3.5l2 2L20 4" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/weather',
        key: 'weather.title',
        glyph: (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        ),
      },
    ],
  },
  {
    items: [
      {
        href: '/farmer/account/notifications',
        key: 'notifications.title',
        glyph: (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/settings',
        key: 'account.tabAccount',
        glyph: (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        ),
      },
    ],
  },
];

const BOTTOM: ReadonlyArray<{ href: string; key: TKey; exact?: boolean; glyph: ReactNode }> = [
  {
    href: '/farmer/account',
    key: 'account.tabOverview',
    exact: true,
    glyph: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 11l8-7 8 7v9H4z" />
      </svg>
    ),
  },
  {
    href: '/market',
    key: 'shell.marketplace',
    glyph: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18" />
      </svg>
    ),
  },
  {
    href: '/farmer/account/listings/new',
    key: 'account.tabPost',
    exact: true,
    glyph: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    ),
  },
  {
    href: '/farmer/account/learn',
    key: 'account.tabLearn',
    glyph: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 5h6a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H4zM20 5h-6a3 3 0 0 0-3 3v11a2 2 0 0 1 2-2h7z" />
      </svg>
    ),
  },
  {
    href: '/farmer/account/settings',
    key: 'account.tabAccount',
    glyph: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    ),
  },
];

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  if (href === '/farmer/account/listings' && pathname === '/farmer/account/listings/new') return false;
  return pathname.startsWith(href);
}

export function AccountShell({ children }: { children: ReactNode }) {
  const { hydrated, language, farmer } = useFarmerSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (hydrated && !farmer) router.replace('/farmer/login');
  }, [hydrated, farmer, router]);

  return (
    <div className={styles.account}>
      <ShopMasthead hideStrip />

      <div className={styles.workspace}>
        <nav className={styles.sidebar} aria-label={t('account.title', language)}>
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi} className={styles.sidebarGroup}>
              {group.label ? (
                <span className={styles.sidebarLabel}>{t(group.label, language)}</span>
              ) : null}
              {group.items.map((item) => {
                const active = isActive(pathname, item.href, item.exact);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={active ? styles.sidebarItemOn : styles.sidebarItem}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className={styles.sidebarGlyph} aria-hidden>
                      {item.glyph}
                    </span>
                    <span>{t(item.key, language)}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <main id="farmer-main" className={styles.main} tabIndex={-1}>
          {farmer ? children : <WorkspaceSkeleton />}
        </main>
      </div>

      <nav className={styles.bottomBar} aria-label={t('account.title', language)}>
        {BOTTOM.map((tab) => {
          const active = isActive(pathname, tab.href, tab.exact);
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
