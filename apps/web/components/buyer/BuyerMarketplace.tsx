'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { LISTING_CATEGORIES, LISTING_GRADES } from '@agri-erp/shared';

import { getLocations, listMarket, type Locations, type MarketQuery } from '@/lib/buyer/api';
import {
  CATEGORY_LABELS,
  GRADE_LABELS,
  formatQuantity,
  formatSsp,
  labelOf,
  UNIT_LABELS,
} from '@/lib/buyer/labels';

import {
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  Field,
  Input,
  Notice,
  PageHeader,
  Select,
  Stamp,
} from '../ui';
import { CardSkeleton, Pagination } from '../ui/data';
import { useBuyer } from './BuyerShell';
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
 * the farmer published, whether the farmer is verified, and where the produce
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
  const { profile } = useBuyer();
  const [draft, setDraft] = useState<MarketQuery>(EMPTY);
  const [applied, setApplied] = useState<MarketQuery>(EMPTY);
  const [locations, setLocations] = useState<Locations | null>(null);

  useEffect(() => {
    getLocations()
      .then(setLocations)
      .catch(() => setLocations(null));
  }, []);

  const key = JSON.stringify(applied);
  const list = useCursorList((cursor) => listMarket({ ...applied, cursor }), key);
  const filtered = useMemo(
    () => Object.values(applied).some((v) => v !== '' && v !== undefined),
    [applied],
  );

  if (!profile.verification.capabilities.browse) {
    return (
      <div className={styles.page}>
        <PageHeader title="Marketplace" />
        <Notice kind="error" title="The marketplace is closed to this account">
          Your buyer account is not in good standing, so the marketplace is not available. Your
          requests and orders remain readable.
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
      <PageHeader
        title="Marketplace"
        subtitle="Produce listed by registered farmers. Prices are indicative; the price on an order is agreed with CORWADO."
      />

      <form className={styles.form} onSubmit={apply} role="search" aria-label="Filter products">
        <div className={styles.filters}>
          <Field label="Search">
            {(ids) => (
              <Input
                {...ids}
                type="search"
                value={draft.q ?? ''}
                placeholder="Product or supplier"
                onChange={(e) => set('q')(e.target.value)}
              />
            )}
          </Field>
          <Field label="Category">
            {(ids) => (
              <Select
                {...ids}
                value={draft.category ?? ''}
                onChange={(e) => set('category')(e.target.value)}
              >
                <option value="">Any category</option>
                {LISTING_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="State">
            {(ids) => (
              <Select
                {...ids}
                value={draft.state_id ?? ''}
                onChange={(e) => set('state_id')(e.target.value)}
              >
                <option value="">Any state</option>
                {(locations?.states ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Grade">
            {(ids) => (
              <Select
                {...ids}
                value={draft.grade ?? ''}
                onChange={(e) => set('grade')(e.target.value)}
              >
                <option value="">Any grade</option>
                {LISTING_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {GRADE_LABELS[g]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="At least this quantity">
            {(ids) => (
              <Input
                {...ids}
                inputMode="decimal"
                value={draft.min_quantity ?? ''}
                onChange={(e) => set('min_quantity')(e.target.value)}
              />
            )}
          </Field>
          <Field label="Available by">
            {(ids) => (
              <Input
                {...ids}
                type="date"
                value={draft.available_by ?? ''}
                onChange={(e) => set('available_by')(e.target.value)}
              />
            )}
          </Field>
          <Field label="Lowest price (SSP)">
            {(ids) => (
              <Input
                {...ids}
                inputMode="decimal"
                value={draft.min_price ?? ''}
                onChange={(e) => set('min_price')(e.target.value)}
              />
            )}
          </Field>
          <Field label="Highest price (SSP)">
            {(ids) => (
              <Input
                {...ids}
                inputMode="decimal"
                value={draft.max_price ?? ''}
                onChange={(e) => set('max_price')(e.target.value)}
              />
            )}
          </Field>
          <Field label="Supplier">
            {(ids) => (
              <Select
                {...ids}
                value={draft.supplier ?? ''}
                onChange={(e) => set('supplier')(e.target.value)}
              >
                <option value="">Any supplier</option>
                <option value="verified">Verified farmers only</option>
              </Select>
            )}
          </Field>
        </div>
        <div className={styles.filterActions}>
          <Button type="submit">Apply filters</Button>
          {filtered ? (
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(EMPTY);
                setApplied(EMPTY);
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </form>

      {list.error ? (
        <EmptyState
          error
          title="The marketplace could not be loaded"
          body={list.error}
          actions={<Button onClick={list.reload}>Try again</Button>}
        />
      ) : list.loading ? (
        <CardSkeleton count={6} />
      ) : list.rows.length === 0 ? (
        <EmptyState
          title={filtered ? 'Nothing matches these filters' : 'Nothing is listed right now'}
          body={
            filtered
              ? 'Widen or clear the filters. You can also send a purchase request describing what you need, and CORWADO will look for suppliers.'
              : 'Send a purchase request describing what you need, and CORWADO will look for suppliers.'
          }
          actions={
            <ButtonLink variant="secondary" href="/buyer/purchase-requests/new">
              New purchase request
            </ButtonLink>
          }
        />
      ) : (
        <>
          <ul className={styles.products} aria-label="Products">
            {list.rows.map((p) => (
              <li key={p.id}>
                <Link href={`/buyer/marketplace/${p.id}`} className={styles.product}>
                  <div className={styles.productTop}>
                    <h2 className={styles.productTitle} dir="auto">
                      {p.title}
                    </h2>
                    {p.quality_grade ? (
                      <Badge tone="nile">{labelOf(GRADE_LABELS, p.quality_grade)}</Badge>
                    ) : null}
                  </div>
                  <p className={styles.productMeta}>
                    {labelOf(CATEGORY_LABELS, p.category)} · {p.location.county}, {p.location.state}
                  </p>
                  <p className={styles.price}>
                    {formatSsp(p.indicative_price_ssp)}{' '}
                    <span className={styles.muted}>per {labelOf(UNIT_LABELS, p.price_per)}</span>
                  </p>
                  <p className={styles.productMeta}>
                    <span className={styles.figure}>
                      {formatQuantity(p.available_quantity, p.unit)}
                    </span>{' '}
                    available from {p.available_from}
                  </p>
                  <div className={styles.productFoot}>
                    <span dir="auto">{p.supplier.trading_name}</span>
                    {p.supplier.verified ? (
                      <Stamp kind="verified">Verified farmer</Stamp>
                    ) : (
                      <Stamp kind="pending">Unverified</Stamp>
                    )}
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
          />
        </>
      )}
    </div>
  );
}
