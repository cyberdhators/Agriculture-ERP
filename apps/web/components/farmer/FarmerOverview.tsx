'use client';

import Link from 'next/link';

import { Boundary } from '@/components/farmers/Boundary';
import { ListingCard } from '@/components/listings/ListingCard';
import { ButtonLink, EmptyState, KpiStrip, Notice, Stamp } from '@/components/ui';
import { farmerPayamName, farmsForFarmer, officerById } from '@/lib/fixtures/farmers';
import { usePreviewContactRequests } from '@/lib/contact/store';
import { useFarmerSession } from '@/lib/farmer-session';
import { VERIFICATION_KEY, verificationStamp } from '@/lib/farmers/verification';
import { LANGUAGE_LABELS, formatDate, formatPhone } from '@/lib/format';
import { t, type TKey } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import { WeatherTile } from './WeatherTile';
import listingStyles from '@/components/listings/listings.module.css';
import styles from './farmer.module.css';

/** The Amazon "Your Account" tiles: a glyph, a title and a one-line sub. */
const ACCOUNT_TILES: ReadonlyArray<{
  href: string;
  title: TKey;
  sub: TKey;
  glyph: React.ReactNode;
}> = [
  {
    href: '/farmer/account/listings/new',
    title: 'account.tilePost',
    sub: 'account.tilePostSub',
    glyph: (
      <svg
        viewBox="0 0 24 24"
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    ),
  },
  {
    href: '/market',
    title: 'shell.marketplace',
    sub: 'account.tileMarketSub',
    glyph: (
      <svg
        viewBox="0 0 24 24"
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6" />
      </svg>
    ),
  },
  {
    href: '/farmer/account/listings',
    title: 'account.tileListings',
    sub: 'account.tileListingsSub',
    glyph: (
      <svg
        viewBox="0 0 24 24"
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 13h8M8 16.5h5" />
      </svg>
    ),
  },
  {
    href: '/farmer/account/farm',
    title: 'account.tileFarm',
    sub: 'account.tileFarmSub',
    glyph: (
      <svg
        viewBox="0 0 24 24"
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M4 20V9l8-5 8 5v11" />
        <path d="M4 20h16M9 20v-6h6v6" />
      </svg>
    ),
  },
  {
    href: '/farmer/account/learn',
    title: 'account.tileLearn',
    sub: 'account.tileLearnSub',
    glyph: (
      <svg
        viewBox="0 0 24 24"
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M4 5h6a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H4z" />
        <path d="M20 5h-6a3 3 0 0 0-3 3v11a2 2 0 0 1 2-2h7z" />
      </svg>
    ),
  },
  {
    href: '/farmer/account/settings',
    title: 'account.tileSecurity',
    sub: 'account.tileSecuritySub',
    glyph: (
      <svg
        viewBox="0 0 24 24"
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
        <path d="M9.5 12l1.8 1.8L15 10" />
      </svg>
    ),
  },
  {
    href: '/farmer/account/settings',
    title: 'account.tileLanguage',
    sub: 'account.tileLanguageSub',
    glyph: (
      <svg
        viewBox="0 0 24 24"
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
      </svg>
    ),
  },
  {
    href: '/farmer/account/settings',
    title: 'account.tileVerification',
    sub: 'account.tileVerificationSub',
    glyph: (
      <svg
        viewBox="0 0 24 24"
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M12 3l2.3 1.6 2.8-.2 1 2.6 2.3 1.6-.8 2.7.8 2.7-2.3 1.6-1 2.6-2.8-.2L12 21l-2.3-1.6-2.8.2-1-2.6-2.3-1.6.8-2.7-.8-2.7 2.3-1.6 1-2.6 2.8.2z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
];

/**
 * The overview: a ruled KPI row (live, drafts, sold, plots, verification), a
 * plain note on what pending or not-verified means while it applies, the three
 * most recent listings as cards, and a side column with the record and the
 * first mapped plot.
 */
export function FarmerOverview() {
  const { farmer, language, listingsFor } = useFarmerSession();
  const contactRequests = usePreviewContactRequests();
  if (!farmer) return null;

  const listings = listingsFor(farmer.id);
  const live = listings.filter((l) => l.status === 'listed').length;
  const drafts = listings.filter((l) => l.status === 'draft').length;
  const sold = listings.filter((l) => l.status === 'sold').length;
  const farms = farmsForFarmer(farmer.id);
  const recent = listings.slice(0, 3);
  const numberPending = farmer.farmer_number.endsWith('-pending');
  const officer = officerById(farmer.caseload_officer_id ?? farmer.registered_by);
  // Buyer requests for this farmer (deliverable (g)). Off live: the browser's
  // preview store; live, a farmer-side route once the farmer principal exists.
  const requests = contactRequests.requests.filter((r) => r.farmer_id === farmer.id);
  const newRequests = requests.filter((r) => r.status === 'new').length;

  return (
    <>
      <PageHead
        title={t('account.tabOverview', language)}
        lead={farmerPayamName(farmer.payam_id)}
        actions={
          <ButtonLink href="/farmer/account/listings/new">
            {t('account.tilePost', language)}
          </ButtonLink>
        }
      />

      <WeatherTile payamId={farmer.payam_id} language={language} />

      <nav className={styles.acctTiles} aria-label={t('account.tilesTitle', language)}>
        {ACCOUNT_TILES.map((tile) => (
          <Link key={tile.href} href={tile.href} className={styles.acctTile}>
            <span className={styles.acctTileGlyph} aria-hidden>
              {tile.glyph}
            </span>
            <span className={styles.acctTileText}>
              <span className={styles.acctTileTitle}>{t(tile.title, language)}</span>
              <span className={styles.acctTileSub}>
                {tile.title === 'account.tileLanguage'
                  ? LANGUAGE_LABELS[language]
                  : t(tile.sub, language)}
              </span>
            </span>
          </Link>
        ))}
      </nav>

      <KpiStrip
        label={t('account.tabOverview', language)}
        items={[
          { label: t('account.kpiLive', language), value: live, accent: live > 0 },
          {
            label: t('account.kpiRequests', language),
            value: newRequests,
            accent: newRequests > 0,
          },
          { label: t('account.kpiDrafts', language), value: drafts },
          { label: t('account.kpiSold', language), value: sold },
          { label: t('account.kpiPlots', language), value: farms.length },
          {
            label: t('account.kpiVerification', language),
            value: (
              <Stamp kind={verificationStamp(farmer.verification_status)}>
                {t(VERIFICATION_KEY[farmer.verification_status], language)}
              </Stamp>
            ),
          },
        ]}
      />

      <div className={styles.overview}>
        <div className={styles.block}>
          {farmer.verification_status === 'pending' ? (
            <Notice kind="warn" title={t('account.whatPendingTitle', language)}>
              <p className="small">{t('account.whatPendingBody', language)}</p>
            </Notice>
          ) : null}
          {farmer.verification_status === 'rejected' ? (
            <Notice kind="error" title={t('account.rejected', language)}>
              <p className="small">{t('account.whatRejectedBody', language)}</p>
            </Notice>
          ) : null}

          <div className={styles.blockHead}>
            <h2>{t('account.requests', language)}</h2>
            <span className="small muted">{requests.length}</span>
          </div>
          {requests.length === 0 ? (
            <p className="small muted" style={{ marginBottom: 'var(--s-5)' }}>
              {t('account.requestsEmpty', language)}
            </p>
          ) : (
            <ul className={styles.learnList} style={{ marginBottom: 'var(--s-5)' }}>
              {requests.slice(0, 5).map((r) => {
                const l = listings.find((x) => x.id === r.listing_id);
                return (
                  <li
                    key={r.id}
                    className={styles.learnItem}
                    style={{ gridTemplateColumns: '1fr' }}
                  >
                    <div className={styles.learnText}>
                      <div className={styles.learnTitle} dir="auto">
                        {r.buyer_name}
                        {l ? ` · ${l.title}` : ''}
                      </div>
                      <div className="small muted" dir="auto">
                        {[r.quantity, r.message].filter(Boolean).join(' · ') ||
                          t('account.requestNoDetail', language)}
                        {' · '}
                        {formatDate(r.created_at, language)}
                        {' · '}
                        {t(`account.request_${r.status}` as 'account.request_new', language)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className={styles.blockHead}>
            <h2>{t('account.recent', language)}</h2>
            <Link href="/farmer/account/listings" className="small">
              {t('account.allListings', language)} ({listings.length})
            </Link>
          </div>
          {recent.length === 0 ? (
            <EmptyState
              title={t('listings.empty', language)}
              body={t('listings.lead', language)}
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
          <div className={styles.block}>
            <div className={styles.blockHead}>
              <h2>{t('account.officer', language)}</h2>
            </div>
            {officer ? (
              <div className={styles.officerCard}>
                <div>
                  <div dir="auto">{officer.name}</div>
                  <div className="small muted">{farmerPayamName(officer.payam_id)}</div>
                </div>
                <ButtonLink href={`tel:${officer.phone}`} variant="secondary">
                  {t('account.call', language)}
                </ButtonLink>
              </div>
            ) : (
              <p className="small muted">{t('account.officerNone', language)}</p>
            )}
            <p className="small muted" style={{ marginTop: 'var(--s-2)' }}>
              {t('account.officerLead', language)}
            </p>
          </div>

          <div className={styles.block}>
            <div className={styles.blockHead}>
              <h2>{t('account.record', language)}</h2>
              <Link href="/farmer/account/settings" className="small">
                {t('account.tabAccount', language)}
              </Link>
            </div>
            <dl className={styles.recordRows}>
              <div className={styles.recordRow}>
                <dt>{t('account.farmerNumber', language)}</dt>
                <dd className={styles.recordValueMono}>
                  {numberPending ? '—' : farmer.farmer_number}
                  {numberPending ? (
                    <span className={styles.recordNote}>
                      {t('account.numberPending', language)}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div className={styles.recordRow}>
                <dt>{t('account.name', language)}</dt>
                <dd dir="auto">
                  {farmer.given_name} {farmer.family_name}
                </dd>
              </div>
              <div className={styles.recordRow}>
                <dt>{t('account.phone', language)}</dt>
                <dd className={styles.recordValueMono}>{formatPhone(farmer.phone)}</dd>
              </div>
              <div className={styles.recordRow}>
                <dt>{t('account.payam', language)}</dt>
                <dd>{farmerPayamName(farmer.payam_id)}</dd>
              </div>
              <div className={styles.recordRow}>
                <dt>{t('account.registered', language)}</dt>
                <dd className={styles.recordValueMono}>
                  {formatDate(farmer.created_at, language)}
                </dd>
              </div>
              <div className={styles.recordRow}>
                <dt>{t('account.language', language)}</dt>
                <dd>{LANGUAGE_LABELS[language]}</dd>
              </div>
            </dl>
          </div>

          <div className={styles.block}>
            <div className={styles.blockHead}>
              <h2>{t('account.tabFarm', language)}</h2>
              <Link href="/farmer/account/farm" className="small">
                {t('account.plot', language)}s ({farms.length})
              </Link>
            </div>
            {farms.length === 0 ? (
              <p className="small muted">{t('account.noFarms', language)}</p>
            ) : (
              <div className={styles.farms}>
                {farms.slice(0, 2).map((farm, i) => (
                  <div key={farm.id} className={styles.farmCard}>
                    <Boundary farm={farm} size={96} />
                    <div>
                      <div>
                        {t('account.plot', language)} {i + 1}
                      </div>
                      <div className={styles.farmMeta}>
                        {farm.season} · {t('account.mapped', language)}{' '}
                        {formatDate(farm.mapped_at, language)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
