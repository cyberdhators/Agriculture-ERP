import {
  FARMERS,
  LISTINGS,
  farmerById,
  farmerPayamName,
  type Farmer,
  type ListingCategory,
  type ListingStatus,
  type ListingUnit,
  type ProduceListing,
} from '@/lib/fixtures/farmers';
import { scopeFarmers } from '@/lib/farmers/presentation';
import type { Role } from '@/lib/preview';

/**
 * The marketplace read model: every listing joined to its seller. Farmers and
 * buyers see listed produce from verified sellers everywhere; staff see the
 * rows their role may see (the same scope the register applies), plus sold
 * and withdrawn rows for the record. Reading is a pure function of the
 * fixture so the B12 swap is a fetch, not a rewrite.
 */
export interface MarketRow {
  listing: ProduceListing;
  seller: Farmer;
}

export type MarketMode = 'public' | 'staff';
export type Availability = 'any' | 'now' | 'soon';
export type MarketSort = 'newest' | 'price_low' | 'price_high' | 'quantity';

/** Listings per page in the browse grid. The B12 fetch keeps the same window. */
export const PAGE_SIZE = 24;

export interface MarketFilters {
  q: string;
  category: ListingCategory | '';
  payam: string;
  unit: ListingUnit | '';
  priceMin: string;
  priceMax: string;
  availability: Availability;
  verifiedOnly: boolean;
  deliveryOnly: boolean;
  status: ListingStatus;
}

export const DEFAULT_FILTERS: MarketFilters = {
  q: '',
  category: '',
  payam: '',
  unit: '',
  priceMin: '',
  priceMax: '',
  availability: 'any',
  verifiedOnly: true,
  deliveryOnly: false,
  status: 'listed',
};

/** True when the shopper has narrowed the browse in any way (not the defaults). */
export function filtersActive(f: MarketFilters): boolean {
  return (
    f.q.trim() !== '' ||
    f.category !== '' ||
    f.payam !== '' ||
    f.unit !== '' ||
    f.priceMin !== '' ||
    f.priceMax !== '' ||
    f.availability !== 'any' ||
    !f.verifiedOnly ||
    f.deliveryOnly
  );
}

export function marketRows(
  mode: MarketMode,
  role: Role,
  overrides: ReadonlyMap<string, ProduceListing> = new Map(),
): MarketRow[] {
  const pool = mode === 'staff' ? new Set(scopeFarmers(FARMERS, role).map((f) => f.id)) : null;
  return LISTINGS.map((l) => overrides.get(l.id) ?? l)
    .filter((l) => (pool ? pool.has(l.farmer_id) : l.status === 'listed'))
    .map((listing) => ({ listing, seller: farmerById(listing.farmer_id) }))
    .filter((r): r is MarketRow => Boolean(r.seller));
}

export function applyFilters(
  rows: readonly MarketRow[],
  f: MarketFilters,
  today: string,
  mode: MarketMode,
): MarketRow[] {
  const min = f.priceMin === '' ? null : Number(f.priceMin);
  const max = f.priceMax === '' ? null : Number(f.priceMax);
  const q = f.q.trim().toLowerCase();
  return rows.filter(({ listing, seller }) => {
    if (mode === 'staff' ? listing.status !== f.status : listing.status !== 'listed') return false;
    if (f.category && listing.category !== f.category) return false;
    if (f.payam && seller.payam_id !== f.payam) return false;
    if (f.unit && listing.unit !== f.unit) return false;
    if (min !== null && listing.price_ssp < min) return false;
    if (max !== null && listing.price_ssp > max) return false;
    if (f.verifiedOnly && seller.verification_status !== 'verified') return false;
    if (f.deliveryOnly && !listing.delivery_available) return false;
    if (q !== '') {
      const hay =
        `${listing.title} ${listing.product_name} ${listing.category}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.availability === 'now') {
      if (listing.available_from > today) return false;
      if (listing.available_until && listing.available_until < today) return false;
    }
    if (f.availability === 'soon' && listing.available_from <= today) return false;
    return true;
  });
}

export function sortRows(rows: readonly MarketRow[], sort: MarketSort): MarketRow[] {
  const out = [...rows];
  switch (sort) {
    case 'price_low':
      return out.sort((a, b) => a.listing.price_ssp - b.listing.price_ssp);
    case 'price_high':
      return out.sort((a, b) => b.listing.price_ssp - a.listing.price_ssp);
    case 'quantity':
      return out.sort((a, b) => b.listing.quantity - a.listing.quantity);
    default:
      return out.sort((a, b) => b.listing.updated_at.localeCompare(a.listing.updated_at));
  }
}

/** The freshest listed rows for the "Fresh this week" featured strip. */
export function featuredRows(rows: readonly MarketRow[], count = 4): MarketRow[] {
  return sortRows(
    rows.filter((r) => r.listing.status === 'listed'),
    'newest',
  ).slice(0, count);
}

/** Other listed rows from the same seller, newest first. */
export function moreFromSeller(
  rows: readonly MarketRow[],
  sellerId: string,
  excludeId: string,
  count = 4,
): MarketRow[] {
  return sortRows(
    rows.filter(
      (r) =>
        r.listing.farmer_id === sellerId &&
        r.listing.id !== excludeId &&
        r.listing.status === 'listed',
    ),
    'newest',
  ).slice(0, count);
}

/** Other listed rows in the same category, newest first. */
export function similarRows(
  rows: readonly MarketRow[],
  category: string,
  excludeId: string,
  count = 4,
): MarketRow[] {
  return sortRows(
    rows.filter(
      (r) =>
        r.listing.category === category &&
        r.listing.id !== excludeId &&
        r.listing.status === 'listed',
    ),
    'newest',
  ).slice(0, count);
}

/** Payams present among the rows, named, for the rail. */
export function payamOptions(rows: readonly MarketRow[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  rows.forEach(({ seller }) => {
    if (!seen.has(seller.payam_id)) seen.set(seller.payam_id, farmerPayamName(seller.payam_id));
  });
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function liveCount(rows: readonly MarketRow[], farmerId: string): number {
  return rows.filter((r) => r.listing.farmer_id === farmerId && r.listing.status === 'listed')
    .length;
}
