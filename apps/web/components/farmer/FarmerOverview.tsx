'use client';

import Link from 'next/link';

import { Boundary } from '@/components/farmers/Boundary';
import { ListingCard } from '@/components/listings/ListingCard';
import { ButtonLink, EmptyState, KpiStrip, Notice, Stamp } from '@/components/ui';
import { farmerPayamName, farmsForFarmer } from '@/lib/fixtures/farmers';
import { useFarmerSession } from '@/lib/farmer-session';
import { VERIFICATION_KEY, verificationStamp } from '@/lib/farmers/verification';
import { LANGUAGE_LABELS, formatDate, formatPhone } from '@/lib/format';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import listingStyles from '@/components/listings/listings.module.css';
import styles from './farmer.module.css';

/**
 * The overview: a ruled KPI row (live, drafts, sold, plots, verification), a
 * plain note on what pending or not-verified means while it applies, the three
 * most recent listings as cards, and a side column with the record and the
 * first mapped plot.
 */
export function FarmerOverview() {
  const { farmer, language, listingsFor } = useFarmerSession();
  if (!farmer) return null;

  const listings = listingsFor(farmer.id);
  const live = listings.filter((l) => l.status === 'listed').length;
  const drafts = listings.filter((l) => l.status === 'draft').length;
  const sold = listings.filter((l) => l.status === 'sold').length;
  const farms = farmsForFarmer(farmer.id);
  const recent = listings.slice(0, 3);
  const numberPending = farmer.farmer_number.endsWith('-pending');

  return (
    <>
      <PageHead
        title={t('account.tabOverview', language)}
        lead={farmerPayamName(farmer.payam_id)}
        actions={
          <ButtonLink href="/farmer/account/listings/new">{t('listings.new', language)}</ButtonLink>
        }
      />

      <KpiStrip
        label={t('account.tabOverview', language)}
        items={[
          { label: t('account.kpiLive', language), value: live, accent: live > 0 },
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
                <dd className={styles.recordValueMono}>{formatDate(farmer.created_at)}</dd>
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
                        {farm.season} · {t('account.mapped', language)} {formatDate(farm.mapped_at)}
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
