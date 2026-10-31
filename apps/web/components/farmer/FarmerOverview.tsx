'use client';

import Link from 'next/link';

import { ShortcutHub } from '@/components/account/ShortcutHub';
import { ListingCard } from '@/components/listings/ListingCard';
import { ButtonLink, EmptyState, Notice } from '@/components/ui';
import { farmerPayamName, farmsForFarmer, officerById } from '@/lib/fixtures/farmers';
import css from '@/components/account/settings.module.css';
import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import { FarmerRequests } from './FarmerRequests';
import { WeatherTile } from './WeatherTile';
import listingStyles from '@/components/listings/listings.module.css';
import styles from './farmer.module.css';

function greetingKey(): 'home.morning' | 'home.afternoon' | 'home.evening' {
  const hour = new Date().getHours();
  return hour < 12 ? 'home.morning' : hour < 17 ? 'home.afternoon' : 'home.evening';
}

export function FarmerOverview() {
  const { farmer, language, listingsFor } = useFarmerSession();
  if (!farmer) return null;

  const listings = listingsFor(farmer.id);
  const live = listings.filter((l) => l.status === 'listed').length;
  const drafts = listings.filter((l) => l.status === 'draft').length;
  // LISTINGS LANE (2026-10-19): `completed`, and the legacy `sold` it replaces.
  const sold = listings.filter((l) => l.status === 'sold' || l.status === 'completed').length;
  const farms = farmsForFarmer(farmer.id);
  const recent = listings.slice(0, 3);
  const officer = officerById(farmer.caseload_officer_id ?? farmer.registered_by);
  const pin = (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
  const stats: [string, number, boolean][] = [
    [t('account.kpiLive', language), live, live > 0],
    [t('account.kpiDrafts', language), drafts, false],
    [t('account.kpiSold', language), sold, false],
    [t('account.kpiPlots', language), farms.length, false],
  ];
  const plots =
    farms.length === 0
      ? t('account.noFarms', language)
      : `${farms.length} ${t('account.plot', language).toLowerCase()}${farms.length === 1 ? '' : 's'}`;

  // 2026-10-31 (the owner: "creatively beautiful", nothing redundant): one
  // calm page -- a welcome on the weather card, the ways in as round icons,
  // the four numbers on one strip, then the farmer's own things. The account
  // links and the full record that sat here are on Account and "Your record".
  return (
    <>
      <PageHead title={t('account.tabOverview', language)} quiet />

      <WeatherTile
        payamId={farmer.payam_id}
        language={language}
        greeting={
          <>
            <p className={styles.greetingHello} suppressHydrationWarning>
              {t(greetingKey(), language)}, <span dir="auto">{farmer.given_name}</span>
            </p>
            {farmer.payam_id ? (
              <p className={styles.greetingPlace}>
                {pin}
                {farmerPayamName(farmer.payam_id)}
              </p>
            ) : null}
          </>
        }
      />

      {!farmer.payam_id ? (
        <Notice
          kind="info"
          title={language === 'ar' ? 'أضف مكانك متى شئت' : 'Add your place when you are ready'}
        >
          <p className="small">
            {language === 'ar'
              ? 'يجلب لك مكانك الطقس والمرشد الزراعي.'
              : 'Your place brings your weather and an extension officer.'}{' '}
            <Link href="/farmer/account/about">
              {language === 'ar' ? 'أضف التفاصيل' : 'Add your details'}
            </Link>
          </p>
        </Notice>
      ) : null}

      {/* 2026-10-28: one home for every ordinary function (infographic no. 4). */}
      <ShortcutHub shell="farmer" language={language === 'ar' ? 'ar' : 'en'} />

      <dl className={styles.stats} aria-label={t('account.tabOverview', language)}>
        {stats.map(([label, value, accent]) => (
          <div key={label} className={styles.stat}>
            <dd className={accent ? `${styles.statValue} ${styles.statAccent}` : styles.statValue}>
              {value}
            </dd>
            <dt className={styles.statLabel}>{label}</dt>
          </div>
        ))}
      </dl>

      <div className={styles.overview}>
        <div className={styles.block}>
          <div id="requests" className={styles.anchor}>
            <FarmerRequests />
          </div>

          <div className={styles.blockHead}>
            <h2>{t('account.recent', language)}</h2>
            <Link href="/farmer/account/listings" className="small">
              {t('account.allListings', language)} ({listings.length})
            </Link>
          </div>
          {recent.length === 0 ? (
            <EmptyState
              title={t('listings.empty', language)}
              actions={
                <ButtonLink href="/farmer/account/listings/new">
                  {t('listings.emptyAction', language)}
                </ButtonLink>
              }
            />
          ) : (
            <div className={listingStyles.grid}>
              {recent.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  lang={language}
                  href={`/farmer/account/listings/${listing.id}`}
                  showStatus
                  actions={
                    <Link href={`/farmer/account/listings/${listing.id}/edit`} className="small">
                      {t('listings.edit', language)}
                    </Link>
                  }
                />
              ))}
            </div>
          )}
        </div>

        <aside className={styles.side}>
          <ul className={css.list}>
            <li className={css.row}>
              <span className={css.rowIcon} aria-hidden>
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <circle cx="9" cy="11" r="2" />
                  <path d="M6 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M14.5 10h3.5M14.5 13.5h2.5" />
                </svg>
              </span>
              <span className={css.rowText}>
                <span className={css.rowLabel}>{t('account.officer', language)}</span>
                <span className={css.rowHint} dir="auto">
                  {officer ? officer.name : t('account.officerNone', language)}
                </span>
              </span>
              {officer ? (
                <ButtonLink href={`tel:${officer.phone}`} variant="secondary" size="small">
                  {t('account.call', language)}
                </ButtonLink>
              ) : null}
            </li>
            <li>
              <Link href="/farmer/account/farm" className={`${css.row} ${css.rowButton}`}>
                <span className={css.rowIcon} aria-hidden>
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6" />
                  </svg>
                </span>
                <span className={css.rowText}>
                  <span className={css.rowLabel}>{t('account.tabFarm', language)}</span>
                  <span className={css.rowHint}>{plots}</span>
                </span>
              </Link>
            </li>
          </ul>
        </aside>
      </div>
    </>
  );
}
