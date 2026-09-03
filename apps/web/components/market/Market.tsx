'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { CategoryGlyph } from '@/components/listings/CategoryGlyph';
import { ListingCard } from '@/components/listings/ListingCard';
import { Photo } from '@/components/listings/Photo';
import { Button, Checkbox, EmptyState, Input, Select, Stamp } from '@/components/ui';
import {
  LISTING_CATEGORIES,
  LISTING_UNITS,
  farmerPayamName,
  type ListingCategory,
  type ListingStatus,
  type ListingUnit,
} from '@/lib/fixtures/farmers';
import {
  CATEGORY_KEY,
  STATUS_KEY,
  UNIT_KEY,
  coverOf,
  formatPrice,
  formatQuantity,
} from '@/lib/farmers/listings';
import { verificationStamp } from '@/lib/farmers/verification';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';
import type { Role } from '@/lib/preview';

import { useMarketModeration } from './moderation';
import {
  DEFAULT_FILTERS,
  applyFilters,
  marketRows,
  payamOptions,
  sortRows,
  type MarketFilters,
  type MarketMode,
  type MarketSort,
} from './marketplace';
import styles from '@/components/listings/listings.module.css';

const SORTS: readonly MarketSort[] = ['newest', 'price_low', 'price_high', 'title'];
const SORT_KEY = {
  newest: 'market.sortNewest',
  price_low: 'market.sortPriceLow',
  price_high: 'market.sortPriceHigh',
  title: 'market.sortTitle',
} as const;
const STAFF_STATUSES: readonly ListingStatus[] = ['listed', 'sold', 'withdrawn'];

/**
 * The marketplace browse: a filter rail (category with its glyph, payam,
 * price range, unit, availability, verified sellers only) beside a sorted
 * card grid or ruled list of the same rows. `mode` decides scope — the public
 * marketplace shows listed produce from everywhere; staff see what their role
 * may see, with sold and withdrawn rows kept for the record.
 */
export function Market({
  mode,
  role,
  lang,
  detailHref,
}: {
  mode: MarketMode;
  role: Role;
  lang: Language;
  detailHref: (id: string) => string;
}) {
  const { overrides } = useMarketModeration();
  const [filters, setFilters] = useState<MarketFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<MarketSort>('newest');
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const today = new Date().toISOString().slice(0, 10);

  const rows = useMemo(() => marketRows(mode, role, overrides), [mode, role, overrides]);
  const shown = useMemo(
    () => sortRows(applyFilters(rows, filters, today, mode), sort),
    [rows, filters, today, mode, sort],
  );
  const payams = useMemo(() => payamOptions(rows), [rows]);
  const categoryCount = (c: ListingCategory | '') =>
    applyFilters(rows, { ...filters, category: c }, today, mode).length;

  const set = <K extends keyof MarketFilters>(key: K, value: MarketFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const dirty = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);
  const unitLabel = (u: ListingUnit) => t(UNIT_KEY[u], lang);

  return (
    <div className={styles.market}>
      <aside className={styles.rail} aria-label={t('market.filters', lang)}>
        <div className={styles.railHead}>
          <span className={styles.railTitle}>{t('market.filters', lang)}</span>
          {dirty ? (
            <Button size="small" variant="ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>
              {t('market.clear', lang)}
            </Button>
          ) : null}
        </div>

        <div className={styles.railGroup}>
          <span className={styles.railLabel}>{t('market.category', lang)}</span>
          <ul className={styles.railList}>
            <li>
              <button
                type="button"
                className={styles.railItem}
                aria-pressed={filters.category === ''}
                onClick={() => set('category', '')}
              >
                {t('market.allCategories', lang)}
                <span className={styles.railCount}>{categoryCount('')}</span>
              </button>
            </li>
            {LISTING_CATEGORIES.map((c) => (
              <li key={c}>
                <button
                  type="button"
                  className={styles.railItem}
                  aria-pressed={filters.category === c}
                  onClick={() => set('category', filters.category === c ? '' : c)}
                >
                  <CategoryGlyph category={c} />
                  {t(CATEGORY_KEY[c], lang)}
                  <span className={styles.railCount}>{categoryCount(c)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.railGroup}>
          <label className={styles.railLabel} htmlFor="market-payam">
            {t('market.payam', lang)}
          </label>
          <Select
            id="market-payam"
            value={filters.payam}
            onChange={(e) => set('payam', e.target.value)}
          >
            <option value="">{t('market.allPayams', lang)}</option>
            {payams.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        <div className={styles.railGroup}>
          <span className={styles.railLabel}>{t('market.price', lang)}</span>
          <div className={styles.railRange}>
            <Input
              aria-label={t('market.priceMin', lang)}
              placeholder={t('market.priceMin', lang)}
              inputMode="numeric"
              className="mono"
              value={filters.priceMin}
              onChange={(e) => set('priceMin', e.target.value.replace(/[^\d]/g, ''))}
            />
            <Input
              aria-label={t('market.priceMax', lang)}
              placeholder={t('market.priceMax', lang)}
              inputMode="numeric"
              className="mono"
              value={filters.priceMax}
              onChange={(e) => set('priceMax', e.target.value.replace(/[^\d]/g, ''))}
            />
          </div>
        </div>

        <div className={styles.railGroup}>
          <label className={styles.railLabel} htmlFor="market-unit">
            {t('market.unit', lang)}
          </label>
          <Select
            id="market-unit"
            value={filters.unit}
            onChange={(e) => set('unit', e.target.value as ListingUnit | '')}
          >
            <option value="">{t('market.allUnits', lang)}</option>
            {LISTING_UNITS.map((u) => (
              <option key={u} value={u}>
                {unitLabel(u)}
              </option>
            ))}
          </Select>
        </div>

        <div className={styles.railGroup}>
          <label className={styles.railLabel} htmlFor="market-availability">
            {t('market.availability', lang)}
          </label>
          <Select
            id="market-availability"
            value={filters.availability}
            onChange={(e) => set('availability', e.target.value as MarketFilters['availability'])}
          >
            <option value="any">{t('market.availableAny', lang)}</option>
            <option value="now">{t('market.availableNow', lang)}</option>
            <option value="soon">{t('market.availableSoon', lang)}</option>
          </Select>
        </div>

        <div className={styles.railGroup}>
          <Checkbox
            label={t('market.verifiedOnly', lang)}
            checked={filters.verifiedOnly}
            onChange={(e) => set('verifiedOnly', e.target.checked)}
          />
        </div>

        {mode === 'staff' ? (
          <div className={styles.railGroup}>
            <label className={styles.railLabel} htmlFor="market-status">
              {t('market.status', lang)}
            </label>
            <Select
              id="market-status"
              value={filters.status}
              onChange={(e) => set('status', e.target.value as ListingStatus)}
            >
              {STAFF_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(STATUS_KEY[s], lang)}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </aside>

      <section className={styles.results} aria-label={t('market.title', lang)}>
        <div className={styles.resultsBar}>
          <span className={styles.resultsCount} aria-live="polite">
            {shown.length} {t(shown.length === 1 ? 'market.one' : 'market.many', lang)}
          </span>
          <span className={styles.resultsSpacer} />
          <label className={styles.resultsControl}>
            {t('market.sort', lang)}
            <select value={sort} onChange={(e) => setSort(e.target.value as MarketSort)}>
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(SORT_KEY[s], lang)}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.viewToggle} role="group" aria-label={t('market.view', lang)}>
            <button type="button" aria-pressed={view === 'cards'} onClick={() => setView('cards')}>
              {t('market.viewCards', lang)}
            </button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
              {t('market.viewList', lang)}
            </button>
          </div>
        </div>

        {shown.length === 0 ? (
          <EmptyState
            title={rows.length === 0 ? t('market.emptyAll', lang) : t('market.empty', lang)}
            body={t('market.lead', lang)}
            actions={
              dirty ? (
                <Button variant="secondary" onClick={() => setFilters(DEFAULT_FILTERS)}>
                  {t('market.clear', lang)}
                </Button>
              ) : undefined
            }
          />
        ) : view === 'cards' ? (
          <div className={styles.grid}>
            {shown.map(({ listing, seller }) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                seller={seller}
                lang={lang}
                href={detailHref(listing.id)}
                showStatus={mode === 'staff' && listing.status !== 'listed'}
              />
            ))}
          </div>
        ) : (
          <div className={styles.listWrap}>
            <table className={styles.listTable}>
              <thead>
                <tr>
                  <th scope="col" className={styles.listThumb}>
                    <span className="visually-hidden">{t('listings.photos', lang)}</span>
                  </th>
                  <th scope="col">{t('market.title_col', lang)}</th>
                  <th scope="col">{t('market.category', lang)}</th>
                  <th scope="col" className="num">
                    {t('listings.quantity', lang)}
                  </th>
                  <th scope="col" className="num">
                    {t('listings.price', lang)}
                  </th>
                  <th scope="col">{t('market.seller', lang)}</th>
                  <th scope="col">{t('market.payam', lang)}</th>
                  <th scope="col" className="num">
                    {t('market.updated', lang)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ listing, seller }) => (
                  <tr key={listing.id}>
                    <td className={styles.listThumb}>
                      <Photo
                        src={coverOf(listing)}
                        category={listing.category}
                        lang={lang}
                        square
                      />
                    </td>
                    <td className="title">
                      <Link href={detailHref(listing.id)} dir="auto">
                        {listing.title}
                      </Link>
                    </td>
                    <td>{t(CATEGORY_KEY[listing.category], lang)}</td>
                    <td className="num">{formatQuantity(listing, unitLabel)}</td>
                    <td className="num">{formatPrice(listing, unitLabel)}</td>
                    <td>
                      <span dir="auto">
                        {seller.given_name} {seller.family_name}
                      </span>{' '}
                      <Stamp kind={verificationStamp(seller.verification_status)}>
                        {t(`account.${seller.verification_status}`, lang)}
                      </Stamp>
                    </td>
                    <td>{farmerPayamName(seller.payam_id)}</td>
                    <td className="num">{formatDate(listing.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
