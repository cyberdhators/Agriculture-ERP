'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CategoryGlyph } from '@/components/listings/CategoryGlyph';
import { ListingCard } from '@/components/listings/ListingCard';
import { Photo } from '@/components/listings/Photo';
import {
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  Stamp,
  Textarea,
} from '@/components/ui';
import { IconX } from '@/components/ui/icons';
import {
  LISTING_CATEGORIES,
  LISTING_UNITS,
  farmerPayamName,
  type ListingCategory,
  type ListingStatus,
  type ListingUnit,
  type ProduceListing,
} from '@/lib/fixtures/farmers';
import {
  CATEGORY_KEY,
  STATUS_KEY,
  UNIT_KEY,
  coverOf,
  formatPrice,
  formatQuantity,
} from '@/lib/farmers/listings';
import { VERIFICATION_KEY, verificationStamp } from '@/lib/farmers/verification';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';
import type { Role } from '@/lib/preview';

import { useMarketModeration } from './moderation';
import {
  DEFAULT_FILTERS,
  PAGE_SIZE,
  applyFilters,
  featuredRows,
  filtersActive,
  marketRows,
  payamOptions,
  sortRows,
  type MarketFilters,
  type MarketMode,
  type MarketSort,
} from './marketplace';
import styles from '@/components/listings/listings.module.css';

const SORTS: readonly MarketSort[] = ['newest', 'price_low', 'price_high', 'quantity'];
const SORT_KEY = {
  newest: 'market.sortNewest',
  price_low: 'market.sortPriceLow',
  price_high: 'market.sortPriceHigh',
  quantity: 'market.sortQuantity',
} as const;
const STAFF_STATUSES: readonly ListingStatus[] = ['listed', 'sold', 'withdrawn'];

/**
 * The marketplace browse, built like a marketplace people have used: a search
 * band with a category chip strip over a sticky filter rail and a paged
 * product grid. `mode` decides scope — the public marketplace shows listed
 * produce from everywhere; staff see what their role may see, with a status
 * filter, sold and withdrawn rows kept for the record, and a moderation menu.
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
  const { overrides, withdraw } = useMarketModeration();
  const searchParams = useSearchParams();
  const qParam = searchParams.get('q') ?? '';
  const [filters, setFilters] = useState<MarketFilters>({ ...DEFAULT_FILTERS, q: qParam });
  const [sort, setSort] = useState<MarketSort>('newest');
  const [view, setView] = useState<'cards' | 'list'>('cards');
  // Phones: the filter rail is closed until asked for, so produce comes first.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [moderating, setModerating] = useState<ProduceListing | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const gridTop = useRef<HTMLDivElement>(null);
  const today = new Date().toISOString().slice(0, 10);

  const rows = useMemo(() => marketRows(mode, role, overrides), [mode, role, overrides]);
  const matched = useMemo(
    () => sortRows(applyFilters(rows, filters, today, mode), sort),
    [rows, filters, today, mode, sort],
  );
  const payams = useMemo(() => payamOptions(rows), [rows]);
  const featured = useMemo(() => featuredRows(rows), [rows]);
  const categoryCount = (c: ListingCategory | '') =>
    applyFilters(rows, { ...filters, category: c }, today, mode).length;

  const active = filtersActive(filters);
  const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const shown = matched.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const showFeatured = !active && current === 1 && featured.length > 0;

  useEffect(() => {
    setPage(1);
  }, [filters, sort]);

  const set = <K extends keyof MarketFilters>(key: K, value: MarketFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const unitLabel = (u: ListingUnit) => t(UNIT_KEY[u], lang);

  function goToPage(p: number) {
    setPage(p);
    gridTop.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // The search lives in the masthead; it navigates to /market?q=… and this
  // keeps the marketplace's own filter in step with that query.
  useEffect(() => {
    setFilters((f) => (f.q === qParam ? f : { ...f, q: qParam }));
  }, [qParam]);

  function confirmWithdraw() {
    if (!moderating) return;
    if (reason.trim().length < 3) {
      setReasonError(t('market.withdrawReasonError', lang));
      return;
    }
    withdraw(moderating, reason.trim());
    setModerating(null);
    setReason('');
    setReasonError(undefined);
  }

  // Removable chips describing what the shopper has narrowed to.
  const applied: Array<{ key: string; label: string; clear: () => void }> = [];
  if (filters.q.trim())
    applied.push({
      key: 'q',
      label: `“${filters.q.trim()}”`,
      clear: () => set('q', ''),
    });
  if (filters.category)
    applied.push({
      key: 'category',
      label: t(CATEGORY_KEY[filters.category], lang),
      clear: () => set('category', ''),
    });
  if (filters.payam)
    applied.push({
      key: 'payam',
      label: farmerPayamName(filters.payam),
      clear: () => set('payam', ''),
    });
  if (filters.unit)
    applied.push({ key: 'unit', label: unitLabel(filters.unit), clear: () => set('unit', '') });
  if (filters.priceMin || filters.priceMax)
    applied.push({
      key: 'price',
      label: `SSP ${filters.priceMin || '0'}–${filters.priceMax || '∞'}`,
      clear: () => setFilters((f) => ({ ...f, priceMin: '', priceMax: '' })),
    });
  if (filters.availability !== 'any')
    applied.push({
      key: 'availability',
      label: t(
        filters.availability === 'now' ? 'market.availableNow' : 'market.availableSoon',
        lang,
      ),
      clear: () => set('availability', 'any'),
    });
  if (filters.deliveryOnly)
    applied.push({
      key: 'delivery',
      label: t('market.deliveryAvailable', lang),
      clear: () => set('deliveryOnly', false),
    });
  if (!filters.verifiedOnly)
    applied.push({
      key: 'verified',
      // The active deviation is that unverified sellers are shown; clearing it
      // restores the verified-only default.
      label: t('market.includingUnverified', lang),
      clear: () => set('verifiedOnly', true),
    });

  function clearAll() {
    setFilters(DEFAULT_FILTERS);
  }

  return (
    <div className={styles.browse}>
      {/* Search and the category strip live in the masthead; the left rail
          holds the full filter set. No in-page search band here. */}
      <div className={styles.body}>
        <button
          type="button"
          className={styles.railToggle}
          aria-expanded={filtersOpen}
          aria-controls="market-filters"
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <span>{t('market.filters', lang)}</span>
          {applied.length > 0 ? (
            <span className={styles.railToggleCount}>{applied.length}</span>
          ) : null}
          <span aria-hidden="true">{filtersOpen ? '▴' : '▾'}</span>
        </button>
        <aside
          id="market-filters"
          className={`${styles.rail} ${filtersOpen ? styles.railOpen : ''}`}
          aria-label={t('market.filters', lang)}
        >
          <div className={styles.railHead}>
            <span className={styles.railTitle}>{t('market.filters', lang)}</span>
          </div>

          {applied.length > 0 ? (
            <div className={styles.applied} aria-label={t('market.applied', lang)}>
              {applied.map((a) => (
                <span key={a.key} className={styles.appliedChip}>
                  <span dir="auto">{a.label}</span>
                  <button
                    type="button"
                    onClick={a.clear}
                    aria-label={`${t('market.remove', lang)}: ${a.label}`}
                  >
                    <IconX size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <details className={styles.section} open>
            <summary>{t('market.category', lang)}</summary>
            <div className={styles.sectionBody}>
              <div className={styles.railList}>
                <button
                  type="button"
                  className={styles.railItem}
                  aria-pressed={filters.category === ''}
                  onClick={() => set('category', '')}
                >
                  {t('market.allCategories', lang)}
                  <span className={styles.railCount}>{categoryCount('')}</span>
                </button>
                {LISTING_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={styles.railItem}
                    aria-pressed={filters.category === c}
                    onClick={() => set('category', filters.category === c ? '' : c)}
                  >
                    <CategoryGlyph category={c} />
                    {t(CATEGORY_KEY[c], lang)}
                    <span className={styles.railCount}>{categoryCount(c)}</span>
                  </button>
                ))}
              </div>
            </div>
          </details>

          <details className={styles.section} open>
            <summary>{t('market.payam', lang)}</summary>
            <div className={styles.sectionBody}>
              <Select value={filters.payam} onChange={(e) => set('payam', e.target.value)}>
                <option value="">{t('market.allPayams', lang)}</option>
                {payams.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          </details>

          <details className={styles.section} open>
            <summary>{t('market.priceRange', lang)}</summary>
            <div className={styles.sectionBody}>
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
          </details>

          <details className={styles.section}>
            <summary>{t('market.unit', lang)}</summary>
            <div className={styles.sectionBody}>
              <Select
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
          </details>

          <details className={styles.section}>
            <summary>{t('market.availability', lang)}</summary>
            <div className={styles.sectionBody}>
              <Select
                value={filters.availability}
                onChange={(e) =>
                  set('availability', e.target.value as MarketFilters['availability'])
                }
              >
                <option value="any">{t('market.availableAny', lang)}</option>
                <option value="now">{t('market.availableNow', lang)}</option>
                <option value="soon">{t('market.availableSoon', lang)}</option>
              </Select>
              <Checkbox
                label={t('market.deliveryAvailable', lang)}
                checked={filters.deliveryOnly}
                onChange={(e) => set('deliveryOnly', e.target.checked)}
              />
              <Checkbox
                label={t('market.verifiedOnly', lang)}
                checked={filters.verifiedOnly}
                onChange={(e) => set('verifiedOnly', e.target.checked)}
              />
            </div>
          </details>

          {mode === 'staff' ? (
            <details className={styles.section} open>
              <summary>{t('market.status', lang)}</summary>
              <div className={styles.sectionBody}>
                <Select
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
            </details>
          ) : null}

          {applied.length > 0 ? (
            <Button size="small" variant="ghost" className={styles.clearAll} onClick={clearAll}>
              {t('market.clearAll', lang)}
            </Button>
          ) : null}
        </aside>

        <section className={styles.results} aria-label={t('market.results', lang)}>
          <div className={styles.resultsBar} ref={gridTop}>
            <span className={styles.resultsCount} aria-live="polite">
              {matched.length} {t(matched.length === 1 ? 'market.one' : 'market.many', lang)}
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
              <button
                type="button"
                aria-pressed={view === 'cards'}
                onClick={() => setView('cards')}
              >
                {t('market.viewCards', lang)}
              </button>
              <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
                {t('market.viewList', lang)}
              </button>
            </div>
          </div>

          {showFeatured ? (
            <div>
              <div className={styles.ruledHead}>
                <h2>{t('market.featured', lang)}</h2>
                <span className={styles.ruledCount}>{featured.length}</span>
              </div>
              <div className={styles.featured}>
                {featured.map(({ listing, seller }) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    seller={seller}
                    lang={lang}
                    href={detailHref(listing.id)}
                  />
                ))}
              </div>
              <p className={styles.trust} style={{ marginTop: 'var(--s-5)' }}>
                {t('market.trust', lang)}
              </p>
            </div>
          ) : null}

          {shown.length === 0 ? (
            <EmptyState
              title={
                rows.length === 0 ? t('market.emptyAll', lang) : t('market.emptyFiltered', lang)
              }
              body={t('market.lead', lang)}
              actions={
                applied.length > 0 ? (
                  <Button variant="secondary" onClick={clearAll}>
                    {t('market.clearAll', lang)}
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
                  onModerate={
                    mode === 'staff' &&
                    (role === 'admin' || role === 'supervisor') &&
                    listing.status === 'listed'
                      ? (l) => setModerating(l)
                      : undefined
                  }
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
                        <span dir="auto">{listing.trading_name}</span>{' '}
                        <Stamp kind={verificationStamp(seller.verification_status)}>
                          {t(VERIFICATION_KEY[seller.verification_status], lang)}
                        </Stamp>
                      </td>
                      <td>{farmerPayamName(seller.payam_id)}</td>
                      <td className="num">{formatDate(listing.updated_at, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pages > 1 ? (
            <nav className={styles.pagination} aria-label={t('market.results', lang)}>
              <button
                type="button"
                className={styles.pageBtn}
                onClick={() => goToPage(current - 1)}
                disabled={current === 1}
              >
                {t('market.prevPage', lang)}
              </button>
              {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={styles.pageBtn}
                  aria-current={p === current}
                  aria-label={`${t('market.goToPage', lang)} ${p}`}
                  onClick={() => goToPage(p)}
                >
                  {p}
                </button>
              ))}
              <button
                type="button"
                className={styles.pageBtn}
                onClick={() => goToPage(current + 1)}
                disabled={current === pages}
              >
                {t('market.nextPage', lang)}
              </button>
            </nav>
          ) : null}
        </section>
      </div>

      <Dialog
        open={moderating !== null}
        onClose={() => setModerating(null)}
        title={t('market.withdrawTitle', lang)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModerating(null)}>
              {t('listingForm.cancel', lang)}
            </Button>
            <Button variant="danger" onClick={confirmWithdraw}>
              {t('market.withdraw', lang)}
            </Button>
          </>
        }
      >
        <p className="small">{t('market.withdrawBody', lang)}</p>
        <Field label={t('market.withdrawReason', lang)} error={reasonError}>
          {(ids) => (
            <Textarea
              {...ids}
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setReasonError(undefined);
              }}
            />
          )}
        </Field>
      </Dialog>
    </div>
  );
}
