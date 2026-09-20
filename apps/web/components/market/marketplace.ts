import type {
  ListingCategory,
  ListingStatus,
  ListingUnit,
  ProduceListing,
} from '@/lib/fixtures/farmers';
import {
  fetchListings,
  toListing,
  toSeller,
  type ApiListing,
  type SellerInfo,
} from '@/lib/listings/api-client';

export interface MarketRow {
  listing: ProduceListing;
  seller: SellerInfo;
}

export type MarketMode = 'public' | 'staff';
export type Availability = 'any' | 'now' | 'soon';
export type MarketSort = 'newest' | 'price_low' | 'price_high' | 'quantity';

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

export async function loadMarketRows(): Promise<MarketRow[]> {
  const listings = await fetchListings({ limit: 200 });
  return listings.map(apiToRow);
}

export async function loadFarmerListings(farmerId: string): Promise<MarketRow[]> {
  const listings = await fetchListings({ farmer_id: farmerId, limit: 200 });
  return listings.map(apiToRow);
}

function apiToRow(api: ApiListing): MarketRow {
  return { listing: toListing(api), seller: toSeller(api) };
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
      const hay = `${listing.title} ${listing.product_name} ${listing.category}`.toLowerCase();
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

export function featuredRows(rows: readonly MarketRow[], count = 4): MarketRow[] {
  return sortRows(
    rows.filter((r) => r.listing.status === 'listed'),
    'newest',
  ).slice(0, count);
}

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

export function payamOptions(rows: readonly MarketRow[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  rows.forEach(({ seller }) => {
    if (seller.payam_id && !seen.has(seller.payam_id)) seen.set(seller.payam_id, seller.payam_name);
  });
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function liveCount(rows: readonly MarketRow[], farmerId: string): number {
  return rows.filter((r) => r.listing.farmer_id === farmerId && r.listing.status === 'listed')
    .length;
}
