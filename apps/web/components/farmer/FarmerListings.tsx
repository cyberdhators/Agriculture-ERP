'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ListingCard } from '@/components/listings/ListingCard';
import { ButtonLink, EmptyState, Tabs } from '@/components/ui';
import type { ListingStatus } from '@/lib/fixtures/farmers';
import { useFarmerSession } from '@/lib/farmer-session';
import { STATUS_KEY } from '@/lib/farmers/listings';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import listingStyles from '@/components/listings/listings.module.css';
import styles from './farmer.module.css';

type Filter = 'all' | ListingStatus;
const FILTERS: readonly Filter[] = ['all', 'listed', 'draft', 'sold', 'withdrawn'];

/**
 * The farmer's own listings as a card grid with a status filter — every
 * status the farmer holds, counted, and the New listing action in the page
 * head. Each card links to its product page; Edit sits in the card foot.
 */
export function FarmerListings() {
  const { farmer, language, listingsFor } = useFarmerSession();
  const [filter, setFilter] = useState<Filter>('all');
  if (!farmer) return null;

  const all = listingsFor(farmer.id);
  const shown = filter === 'all' ? all : all.filter((l) => l.status === filter);
  const count = (f: Filter) =>
    f === 'all' ? all.length : all.filter((l) => l.status === f).length;

  return (
    <>
      <PageHead
        title={t('listings.title', language)}
        lead={t('listings.lead', language)}
        actions={
          <ButtonLink href="/farmer/account/listings/new">{t('listings.new', language)}</ButtonLink>
        }
      />

      {all.length === 0 ? (
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
                label: f === 'all' ? t('listings.all', language) : t(STATUS_KEY[f], language),
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
                  actions={
                    <Link href={`/farmer/account/listings/${listing.id}/edit`} className="small">
                      {t('listings.edit', language)}
                    </Link>
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
