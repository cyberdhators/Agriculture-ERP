'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { LISTING_CATEGORIES, LISTING_GRADES } from '@agri-erp/shared';

import { SaveSearchPanel } from '@/components/account/SavedSearches';
import { getLocations, listMarket, type Locations, type MarketQuery } from '@/lib/buyer/api';
import { categoryLabel, categoryLabelOf, formatSsp } from '@/lib/buyer/labels';
import { t } from '@/lib/i18n';

import { Badge, Button, EmptyState, Field, Input, Notice, PageHeader, Select } from '../ui';
import { CardSkeleton, Pagination } from '../ui/data';
import { useBuyer } from './BuyerShell';
import { gradeIn, perUnitIn, quantityIn } from './Timeline';
import { useCursorList } from './useCursorList';
import styles from './buyer.module.css';

/**
 * THE BUYER MARKETPLACE (C-14B.7, C-14B.9).
 *
 * Every filter is sent to the server, which filters and pages in the
 * database; this screen holds one page at a time and nothing more. Applying
 * filters is an explicit action, so a half-typed price does not send a query
 * per keystroke.
 *
 * What a card shows of the seller is what the route returns: the trading name
 * the farmer published and where the produce (2026-10-31: no farmer badge)
 * is. No phone, no legal name -- the route does not have them to give.
 */

const EMPTY: MarketQuery = {
  q: '',
  category: '',
  state_id: '',
  min_quantity: '',
  available_by: '',
  grade: '',
  min_price: '',
  max_price: '',
  supplier: '',
};

export function BuyerMarketplace() {
  const { profile, language } = useBuyer();
  const w = (key: Parameters<typeof t>[0]) => t(key, language);
  const [draft, setDraft] = useState<MarketQuery>(EMPTY);
  const [applied, setApplied] = useState<MarketQuery>(EMPTY);
  const [locations, setLocations] = useState<Locations | null>(null);
  // 2026-10-31: on a phone the seven narrower filters fold behind one button.
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    getLocations()
      .then(setLocations)
      .catch(() => setLocations(null));
  }, []);

  const key = JSON.stringify(applied);
  const list = useCursorList((cursor) => listMarket({ ...applied, cursor }), key);
  const narrowed = (Object.keys(applied) as (keyof MarketQuery)[]).filter(
    (k) => k !== 'q' && applied[k] !== undefined && applied[k] !== '',
  ).length;
  const filtered = useMemo(
    () => Object.values(applied).some((v) => v !== '' && v !== undefined),
    [applied],
  );

  if (!profile.verification.capabilities.browse) {
    return (
      <div className={styles.page}>
        <PageHeader title={w('buyer.nav.marketplace')} />
        <Notice kind="error" title={w('buyer.mkt.closed')}>
          {w('buyer.mkt.closedBody')}
        </Notice>
      </div>
    );
  }

  const set = (field: keyof MarketQuery) => (value: string) =>
    setDraft((d) => ({ ...d, [field]: value }));

  const apply = (event: FormEvent) => {
    event.preventDefault();
    setApplied(draft);
  };

  return (
    <div className={styles.page}>
      <PageHeader title={w('buyer.nav.marketplace')} subtitle={w('buyer.mkt.subtitle')} />
      {/* 2026-10-31: the rest of the market as four quiet pills, not a sentence of links. */}
      <nav className={styles.pills} aria-label={w('buyer.mkt.alsoAria')}>
        <Link href="/market/requests">{w('buyer.nav.buyingRequests')}</Link>
        <Link href="/market/services">{w('buyer.mkt.services')}</Link>
        <Link href="/buyer/buying-requests/new">{w('buyer.mkt.postNeed')}</Link>
        <Link href="/buyer/services/new">{w('buyer.mkt.offerService')}</Link>
      </nav>

      <form
        className={styles.form}
        onSubmit={apply}
        role="search"
        aria-label={w('buyer.mkt.filterAria')}
      >
        <div className={styles.filters}>
          <Field label={w('buyer.mkt.search')}>
            {(ids) => (
              <Input
                {...ids}
                type="search"
                value={draft.q ?? ''}
                placeholder={w('buyer.mkt.searchPlaceholder')}
                onChange={(e) => set('q')(e.target.value)}
              />
            )}
          </Field>
          <button
            type="button"
            className={styles.moreToggle}
            aria-expanded={moreOpen}
            aria-controls="buyer-more-filters"
            onClick={() => setMoreOpen((v) => !v)}
          >
            {w(moreOpen ? 'buyer.mkt.fewer' : 'buyer.mkt.more')}
            {narrowed > 0 ? <span className={styles.moreCount}>{narrowed}</span> : null}
          </button>
          <div id="buyer-more-filters" className={moreOpen ? styles.moreOpen : styles.more}>
            <Field label={w('buyer.w.category')}>
              {(ids) => (
                <Select
                  {...ids}
                  value={draft.category ?? ''}
                  onChange={(e) => set('category')(e.target.value)}
                >
                  <option value="">{w('buyer.mkt.anyCategory')}</option>
                  {LISTING_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {categoryLabel(c, language)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={w('buyer.sell.state')}>
              {(ids) => (
                <Select
                  {...ids}
                  value={draft.state_id ?? ''}
                  onChange={(e) => set('state_id')(e.target.value)}
                >
                  <option value="">{w('buyer.mkt.anyState')}</option>
                  {(locations?.states ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={w('buyer.mkt.grade')}>
              {(ids) => (
                <Select
                  {...ids}
                  value={draft.grade ?? ''}
                  onChange={(e) => set('grade')(e.target.value)}
                >
                  <option value="">{w('buyer.mkt.anyGrade')}</option>
                  {LISTING_GRADES.map((g) => (
                    <option key={g} value={g}>
                      {gradeIn(g, language)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={w('buyer.mkt.minQuantity')}>
              {(ids) => (
                <Input
                  {...ids}
                  inputMode="decimal"
                  value={draft.min_quantity ?? ''}
                  onChange={(e) => set('min_quantity')(e.target.value)}
                />
              )}
            </Field>
            <Field label={w('buyer.mkt.availableBy')}>
              {(ids) => (
                <Input
                  {...ids}
                  type="date"
                  value={draft.available_by ?? ''}
                  onChange={(e) => set('available_by')(e.target.value)}
                />
              )}
            </Field>
            <Field label={w('buyer.mkt.minPrice')}>
              {(ids) => (
                <Input
                  {...ids}
                  inputMode="decimal"
                  value={draft.min_price ?? ''}
                  onChange={(e) => set('min_price')(e.target.value)}
                />
              )}
            </Field>
            <Field label={w('buyer.mkt.maxPrice')}>
              {(ids) => (
                <Input
                  {...ids}
                  inputMode="decimal"
                  value={draft.max_price ?? ''}
                  onChange={(e) => set('max_price')(e.target.value)}
                />
              )}
            </Field>
          </div>
          {/* LISTINGS LANE (2026-10-19): no "verified farmers only" filter --
              verification is a badge, shown and never filtered on. */}
        </div>
        <div className={styles.filterActions}>
          <Button type="submit">{w('buyer.mkt.apply')}</Button>
          {filtered ? (
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(EMPTY);
                setApplied(EMPTY);
              }}
            >
              {w('buyer.mkt.clear')}
            </Button>
          ) : null}
        </div>
      </form>

      {/* 2026-11-03: "tell me when produce like this is listed". */}
      <SaveSearchPanel
        lang={language}
        target="listing"
        seed={{
          product_name: applied.q ?? '',
          category: applied.category ?? '',
          state_id: applied.state_id ?? '',
          max_price: applied.max_price ?? '',
        }}
        savedHref="/buyer/saved-searches"
      />

      {list.error ? (
        <EmptyState
          error
          title={w('buyer.mkt.loadFailed')}
          body={list.error}
          actions={<Button onClick={list.reload}>{w('buyer.common.retry')}</Button>}
        />
      ) : list.loading ? (
        <CardSkeleton count={6} />
      ) : list.rows.length === 0 ? (
        <EmptyState
          title={w(filtered ? 'buyer.mkt.noMatch' : 'buyer.mkt.noneListed')}
          body={w(filtered ? 'buyer.mkt.noMatchBody' : 'buyer.mkt.noneListedBody')}
        />
      ) : (
        <>
          <ul className={styles.products} aria-label={w('buyer.mkt.products')}>
            {list.rows.map((p) => (
              <li key={p.id}>
                <Link href={`/buyer/marketplace/${p.id}`} className={styles.product}>
                  <div className={styles.productTop}>
                    <h2 className={styles.productTitle} dir="auto">
                      {p.title}
                    </h2>
                    {p.quality_grade ? (
                      <Badge tone="nile">{gradeIn(p.quality_grade, language)}</Badge>
                    ) : null}
                  </div>
                  <p className={styles.productMeta}>
                    {categoryLabelOf(p.category, language)} · {p.location.county},{' '}
                    {p.location.state}
                  </p>
                  <p className={styles.price}>
                    {formatSsp(p.indicative_price_ssp)}{' '}
                    <span className={styles.muted}>{perUnitIn(p.price_per, language)}</span>
                  </p>
                  <p className={styles.productMeta}>
                    <span className={styles.figure}>
                      {quantityIn(p.available_quantity, p.unit, language)}
                    </span>{' '}
                    {w('buyer.mkt.availableFrom').replace('{date}', p.available_from)}
                  </p>
                  <div className={styles.productFoot}>
                    <span dir="auto">{p.supplier.trading_name}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination
            shown={list.rows.length}
            hasMore={list.hasMore}
            onNext={list.goNext}
            onPrevious={list.goBack}
            canGoBack={list.canGoBack}
            busy={list.loading}
            language={language}
          />
        </>
      )}
    </div>
  );
}
