'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { lifecycleStage, type LifecycleStage } from '@agri-erp/shared';

import { CorrectionNotice, CorrectionStamp, useOpenCorrections } from '@/components/account/Corrections';
import { ListingCard } from '@/components/listings/ListingCard';
import { ButtonLink, EmptyState, Tabs } from '@/components/ui';
import type { ProduceListing } from '@/lib/fixtures/farmers';
import { useFarmerSession } from '@/lib/farmer-session';
import { STAGE_KEY, todayLocal } from '@/lib/market-posts/presentation';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import listingStyles from '@/components/listings/listings.module.css';
import styles from './farmer.module.css';

// LISTINGS LANE (2026-10-19): the tabs are the lifecycle stages, `expired` included.
type Filter = 'all' | LifecycleStage;
const FILTERS: readonly Filter[] = [
  'all',
  'active',
  'draft',
  'paused',
  'expired',
  'completed',
  'withdrawn',
];

export function FarmerListings() {
  const { farmer, language, listingsFor, refresh, isPending } = useFarmerSession();
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  // 2026-10-27: a moderator's correction requests on these listings.
  const corrections = useOpenCorrections('produce_listing');

  // The session holds the farmer's own listings (GET /api/farmer/listings);
  // reload on arrival so a listing saved on another device shows here too.
  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  const all: ProduceListing[] = farmer ? listingsFor(farmer.id) : [];

  if (!farmer) return null;

  const today = todayLocal();
  const stageOf = (l: ProduceListing) => lifecycleStage(l.status, l.available_until, today);
  const shown = filter === 'all' ? all : all.filter((l) => stageOf(l) === filter);
  const count = (f: Filter) =>
    f === 'all' ? all.length : all.filter((l) => stageOf(l) === f).length;

  return (
    <>
      <PageHead
        title={t('listings.title', language)}
        lead={t('listings.lead', language)}
        actions={
          <ButtonLink href="/farmer/account/listings/new">{t('listings.new', language)}</ButtonLink>
        }
      />

      <CorrectionNotice
        items={corrections.items}
        lang={language}
        editHref={(id) => `/farmer/account/listings/${id}/edit`}
      />

      {loading ? (
        <p className="muted">{t('market.loading', language)}</p>
      ) : all.length === 0 ? (
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
        <>
          <div className={styles.toolbar}>
            <Tabs
              label={t('listings.status', language)}
              value={filter}
              onChange={setFilter}
              items={FILTERS.filter((f) => f === 'all' || count(f) > 0).map((f) => ({
                key: f,
                label: f === 'all' ? t('listings.all', language) : t(STAGE_KEY[f], language),
                count: count(f),
              }))}
            />
          </div>
          {shown.length === 0 ? (
            <p className="muted">{t('listings.emptyFiltered', language)}</p>
          ) : (
            <div className={listingStyles.grid}>
              {shown.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  lang={language}
                  href={`/farmer/account/listings/${listing.id}`}
                  showStatus
                  stage={stageOf(listing)}
                  actions={
                    <>
                      {corrections.ids.has(listing.id) ? (
                        <>
                          <CorrectionStamp lang={language} />{' '}
                        </>
                      ) : null}
                      <Link href={`/farmer/account/listings/${listing.id}/edit`} className="small">
                        {t('listings.edit', language)}
                      </Link>
                      {isPending(listing.id) ? (
                        <span className="small muted">
                          {' '}
                          · {language === 'ar' ? 'في انتظار الإرسال' : 'Waiting to send'}
                        </span>
                      ) : null}
                    </>
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
