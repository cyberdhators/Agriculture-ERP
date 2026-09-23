'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ListingCard } from '@/components/listings/ListingCard';
import { ButtonLink, EmptyState, Tabs } from '@/components/ui';
import type { ListingStatus, ProduceListing } from '@/lib/fixtures/farmers';
import { useFarmerSession } from '@/lib/farmer-session';
import { STATUS_KEY } from '@/lib/farmers/listings';
import { fetchListings, toListing } from '@/lib/listings/api-client';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import listingStyles from '@/components/listings/listings.module.css';
import styles from './farmer.module.css';

type Filter = 'all' | ListingStatus;
const FILTERS: readonly Filter[] = ['all', 'listed', 'draft', 'sold', 'withdrawn'];

export function FarmerListings() {
  const { farmer, language, listingsFor } = useFarmerSession();
  const [filter, setFilter] = useState<Filter>('all');
  const [all, setAll] = useState<ProduceListing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!farmer) return;
    let cancelled = false;
    setLoading(true);
    fetchListings({ farmer_id: farmer.id, limit: 200 })
      .then((data) => {
        if (cancelled) return;
        const apiListings = data.map(toListing);
        const local = listingsFor(farmer.id);
        const apiIds = new Set(apiListings.map((l) => l.id));
        const merged = [...apiListings, ...local.filter((l) => !apiIds.has(l.id))];
        setAll(merged.sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
      })
      .catch(() => {
        if (!cancelled) setAll(listingsFor(farmer.id));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [farmer, listingsFor]);

  if (!farmer) return null;

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
