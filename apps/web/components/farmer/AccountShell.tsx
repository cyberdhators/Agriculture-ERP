'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { Wordmark } from '@/components/brand/Wordmark';
import { Skeleton } from '@/components/ui';
import { useFarmerSession } from '@/lib/farmer-session';
import { useUnreadNotifications } from '@/lib/farmer-unread';
import { useHasAdviceProfile } from '@/lib/advice/client';
import { useUnreadMessages } from '@/lib/messages/client';
import { FARMER_PAGES, keepPagesOffline } from '@/lib/pwa/keep';
import { t, type TKey } from '@/lib/i18n';

import { SupportContactsLine } from '../support/SupportContacts';
import { ShopMasthead } from './ShopMasthead';
import styles from './farmer.module.css';

/* ── Sidebar navigation ─────────────────────────────────────────────── */

interface NavItem {
  href: string;
  key: TKey;
  exact?: boolean;
  glyph: ReactNode;
  /** Shown only when the account has an advice profile (2026-10-22). */
  providerOnly?: boolean;
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
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
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
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
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
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
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
        key: 'account.tilePost',
        exact: true,
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
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
        href: '/farmer/account/listings',
        key: 'account.tabListings',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18M8 13h8M8 16.5h5" />
          </svg>
        ),
      },
      // LISTINGS LANE (2026-10-19): buying requests and services.
      {
        href: '/farmer/account/buying-requests',
        key: 'requests.mineTitle',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M4 5h16v10H8l-4 4V5z" />
            <path d="M8 9h8M8 12h5" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/my-services',
        key: 'svc.mineTitle',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="7" cy="17" r="3" />
            <circle cx="18" cy="17" r="2" />
            <path d="M4 14V8h7l3 4h5v5M10 17h6" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/prices',
        key: 'prices.title',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
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
        // 2026-10-17: AgriOne AI in place of the learning library.
        href: '/farmer/account/ai',
        key: 'account.tabAi',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
            <path d="M8.5 11h7M8.5 14.5h4.5" />
          </svg>
        ),
      },
      {
        // 2026-10-22: Advice & Learning's published guides, the public page
        // (/learn), beside AgriOne AI -- not in place of it.
        href: '/learn',
        key: 'account.tabGuides',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z" />
            <path d="M4 19a2 2 0 0 1 2-2h13M8 7h7M8 10.5h5" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/services',
        key: 'services.title',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
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
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        ),
      },
    ],
  },
  {
    // 2026-10-22: independent advice -- find a provider and ask; offer advice.
    label: 'nav.advice',
    items: [
      {
        href: '/advice',
        key: 'advice.find',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="11" cy="11" r="6" />
            <path d="M20 20l-4.5-4.5M9 9.5a2 2 0 1 1 2.5 1.9V13M11 15.5v.01" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/advice/requests',
        key: 'advice.myRequests',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M4 5h16v11H9l-5 4V5z" />
            <path d="M10 9a2 2 0 1 1 2.5 1.9V12M12.5 14v.01" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/advice/offer',
        key: 'advice.offer',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="9" cy="8" r="3.5" />
            <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
            <path d="M18 8v6M15 11h6" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/advice/work',
        key: 'advice.work',
        providerOnly: true,
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <rect x="3" y="7" width="18" height="13" rx="2" />
            <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" />
          </svg>
        ),
      },
    ],
  },
  {
    items: [
      {
        // 2026-10-20: in-app messaging about posts.
        href: '/farmer/account/messages',
        key: 'msg.title',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/notifications',
        key: 'notifications.title',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        ),
      },
      {
        // 2026-10-23: public profiles v2 -- draft, preview, publish, photo.
        href: '/farmer/account/public-profile',
        key: 'pp.menu',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="11" r="2.5" />
            <path d="M5.5 17a3.5 3.5 0 0 1 7 0M15 10h3M15 14h3" />
          </svg>
        ),
      },
      {
        // 2026-10-19: who you are, what you do (optional).
        href: '/farmer/account/about',
        key: 'account.tabAbout',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="9" cy="8" r="3.5" />
            <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
            <path d="M16 7h6M16 11h6M18 15h4" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/settings',
        key: 'account.tabAccount',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/security',
        key: 'account.tileSecurity',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
            <path d="M9.5 12l1.8 1.8L15 10" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/language',
        key: 'account.tileLanguage',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
          </svg>
        ),
      },
      {
        href: '/farmer/account/verification',
        key: 'account.tileVerification',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M12 3l2.3 1.6 2.8-.2 1 2.6 2.3 1.6-.8 2.7.8 2.7-2.3 1.6-1 2.6-2.8-.2L12 21l-2.3-1.6-2.8.2-1-2.6-2.3-1.6.8-2.7-.8-2.7 2.3-1.6 1-2.6 2.8.2z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        ),
      },
      {
        // 2026-10-21: "Contact CORWADO" -- FAQs and a message form.
        href: '/help',
        key: 'help.title',
        glyph: (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6" />
            <path d="M12 17h.01" />
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
    href: '/farmer/account/ai',
    key: 'account.tabAi',
    glyph: (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        <path d="M8.5 11h7M8.5 14.5h4.5" />
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

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  if (href === '/farmer/account/listings' && pathname === '/farmer/account/listings/new')
    return false;
  return pathname.startsWith(href);
}

export function AccountShell({ children }: { children: ReactNode }) {
  const { hydrated, language, farmer } = useFarmerSession();
  const unread = useUnreadNotifications(Boolean(farmer));
  const unreadMessages = useUnreadMessages(Boolean(farmer));
  const adviser = useHasAdviceProfile(Boolean(farmer));
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (hydrated && !farmer) router.replace('/farmer/login');
  }, [hydrated, farmer, router]);

  // PWA: a signed-in farmer's pages are stored so the app opens them offline.
  useEffect(() => {
    if (farmer) keepPagesOffline('/farmer/account', FARMER_PAGES);
  }, [farmer]);

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
              {group.items
                .filter((item) => adviser || !item.providerOnly)
                .map((item) => {
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
                      {item.href === '/farmer/account/messages' && unreadMessages > 0 ? (
                        <span className={styles.bellBadge}>
                          {unreadMessages > 99 ? '99+' : unreadMessages}
                        </span>
                      ) : null}
                      {item.href === '/farmer/account/notifications' && unread > 0 ? (
                        <span className={styles.bellBadge}>{unread > 99 ? '99+' : unread}</span>
                      ) : null}
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
          {/* 2026-10-25: support contacts as published in Settings. */}
          <SupportContactsLine language={language} />
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
