'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { Wordmark } from '@/components/brand/Wordmark';
import { Skeleton, Stamp } from '@/components/ui';
import { useFarmerSession } from '@/lib/farmer-session';
import { VERIFICATION_KEY, verificationStamp } from '@/lib/farmers/verification';
import { t, type TKey } from '@/lib/i18n';

import styles from './farmer.module.css';

const TABS: ReadonlyArray<{ href: string; key: TKey; exact?: boolean }> = [
  { href: '/farmer/account', key: 'account.tabOverview', exact: true },
  { href: '/farmer/account/listings', key: 'account.tabListings' },
  { href: '/farmer/account/farm', key: 'account.tabFarm' },
  { href: '/farmer/account/settings', key: 'account.tabAccount' },
];

/**
 * The signed-in workspace shell: a sticky forest masthead carrying the
 * wordmark, the four tabs (Overview · My listings · My farm · Account) and, at
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
      <header className={styles.masthead}>
        <div className={styles.mastheadInner}>
          <Wordmark href="/farmer/account" size={22} onBand />
          <nav className={styles.mastNav} aria-label={t('account.title', language)}>
            {TABS.map((tab) => {
              const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={styles.mastTab}
                  aria-current={active ? 'page' : undefined}
                >
                  {t(tab.key, language)}
                </Link>
              );
            })}
            <Link href="/market" className={`${styles.mastTab}`}>
              {t('shell.marketplace', language)}
            </Link>
          </nav>
          <div className={styles.mastIdentity}>
            {farmer ? (
              <>
                <Link href="/farmer/account/settings" className={styles.mastName} dir="auto">
                  {farmer.given_name} {farmer.family_name}
                </Link>
                <Stamp kind={verificationStamp(farmer.verification_status)}>
                  {t(VERIFICATION_KEY[farmer.verification_status], language)}
                </Stamp>
              </>
            ) : (
              <Skeleton width={160} height={16} />
            )}
          </div>
        </div>
      </header>

      <main id="farmer-main" className={styles.main} tabIndex={-1}>
        {farmer ? children : <WorkspaceSkeleton />}
      </main>

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
