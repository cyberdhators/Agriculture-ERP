import { parseSouthSudanMobile } from '@agri-erp/shared';

import type { StampKind } from '@/components/ui';
import type { TKey } from '@/lib/i18n';
import {
  LISTING_DESCRIPTION_MAX,
  type Farmer,
  type ListingCategory,
  type ListingStatus,
  type ListingUnit,
  type ProduceListing,
} from '@/lib/fixtures/farmers';

/**
 * Everything the farmer flow and the marketplace share about a product
 * listing: how a status reads, how a price is written ("SSP 35,000 / 100 kg
 * bag"), which photo is the cover, and the one client-side validation that
 * mirrors B12 point 5 field-for-field. The one rule enforced here: a listing
 * can only be `listed` when the farmer is verified. Draft is always allowed; a
 * pending farmer sees the exact reason. Colour backs the word; the word
 * carries the meaning.
 */

const STATUS_STAMP: Record<ListingStatus, StampKind> = {
  draft: 'neutral',
  listed: 'verified',
  withdrawn: 'merged',
  sold: 'info',
};

export function listingStamp(status: ListingStatus): StampKind {
  return STATUS_STAMP[status];
}

export const STATUS_KEY: Record<ListingStatus, TKey> = {
  draft: 'status.draft',
  listed: 'status.listed',
  withdrawn: 'status.withdrawn',
  sold: 'status.sold',
};

export const CATEGORY_KEY: Record<ListingCategory, TKey> = {
  crop: 'category.crop',
  vegetable: 'category.vegetable',
  fruit: 'category.fruit',
  livestock: 'category.livestock',
  poultry: 'category.poultry',
  dairy: 'category.dairy',
  fish: 'category.fish',
  processed: 'category.processed',
  seeds_inputs: 'category.seeds_inputs',
  other: 'category.other',
};

export const UNIT_KEY: Record<ListingUnit, TKey> = {
  kg: 'unit.kg',
  bag_50kg: 'unit.bag_50kg',
  bag_100kg: 'unit.bag_100kg',
  sack: 'unit.sack',
  crate: 'unit.crate',
  bunch: 'unit.bunch',
  piece: 'unit.piece',
  head: 'unit.head',
  litre: 'unit.litre',
  tin: 'unit.tin',
};

/** English labels for the staff portal, which does not run through `t()`. */
export const CATEGORY_LABELS: Record<ListingCategory, string> = {
  crop: 'Crop',
  vegetable: 'Vegetable',
  fruit: 'Fruit',
  livestock: 'Livestock',
  poultry: 'Poultry',
  dairy: 'Dairy',
  fish: 'Fish',
  processed: 'Processed',
  seeds_inputs: 'Seeds & inputs',
  other: 'Other',
};

export const UNIT_LABELS: Record<ListingUnit, string> = {
  kg: 'kg',
  bag_50kg: '50 kg bag',
  bag_100kg: '100 kg bag',
  sack: 'sack',
  crate: 'crate',
  bunch: 'bunch',
  piece: 'piece',
  head: 'head',
  litre: 'litre',
  tin: 'tin',
};

export const STATUS_LABELS: Record<ListingStatus, string> = {
  draft: 'Draft',
  listed: 'Listed',
  withdrawn: 'Withdrawn',
  sold: 'Sold',
};

/** A farmer may publish (move a listing to `listed`) only once verified. */
export function canPublishListings(farmer: Pick<Farmer, 'verification_status'>): boolean {
  return farmer.verification_status === 'verified';
}

export function formatSsp(amount: number): string {
  return `SSP ${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(amount)}`;
}

/** "SSP 35,000 / 100 kg bag" — the price line, with the unit label supplied. */
export function formatPrice(
  listing: Pick<ProduceListing, 'price_ssp' | 'price_per'>,
  unitLabel: (unit: ListingUnit) => string,
): string {
  return `${formatSsp(listing.price_ssp)} / ${unitLabel(listing.price_per)}`;
}

/** "8 × 100 kg bag" or "120 kg" — a quantity written the way it is sold. */
export function formatQuantity(
  listing: Pick<ProduceListing, 'quantity' | 'unit'>,
  unitLabel: (unit: ListingUnit) => string,
): string {
  const n = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(listing.quantity);
  return listing.unit === 'kg' || listing.unit === 'litre'
    ? `${n} ${unitLabel(listing.unit)}`
    : `${n} × ${unitLabel(listing.unit)}`;
}

export function coverOf(listing: Pick<ProduceListing, 'photo_storage_paths'>): string | null {
  return listing.photo_storage_paths[0] ?? null;
}

/* ---- Form values and validation -------------------------------------- */

/** What the listing form holds: every B12 point 5 field, as strings. */
export interface ListingFormValues {
  title: string;
  category: ListingCategory | '';
  product_name: string;
  description: string;
  quantity: string;
  unit: ListingUnit | '';
  price_ssp: string;
  price_per: ListingUnit | '';
  negotiable: boolean;
  available_from: string;
  available_until: string;
  harvest_season: string;
  pickup_notes: string;
  contact_phone: string;
  delivery_available: boolean;
}

export type ListingField = keyof ListingFormValues;

export function emptyListingValues(contactPhone: string, today: string): ListingFormValues {
  return {
    title: '',
    category: '',
    product_name: '',
    description: '',
    quantity: '',
    unit: '',
    price_ssp: '',
    price_per: '',
    negotiable: false,
    available_from: today,
    available_until: '',
    harvest_season: '',
    pickup_notes: '',
    contact_phone: contactPhone,
    delivery_available: false,
  };
}

export function listingToValues(listing: ProduceListing): ListingFormValues {
  return {
    title: listing.title,
    category: listing.category,
    product_name: listing.product_name,
    description: listing.description,
    quantity: String(listing.quantity),
    unit: listing.unit,
    price_ssp: String(listing.price_ssp),
    price_per: listing.price_per,
    negotiable: listing.negotiable,
    available_from: listing.available_from,
    available_until: listing.available_until ?? '',
    harvest_season: listing.harvest_season ?? '',
    pickup_notes: listing.pickup_notes ?? '',
    contact_phone: listing.contact_phone.replace(/^\+211/, ''),
    delivery_available: listing.delivery_available,
  };
}

export type ListingErrors = Partial<Record<ListingField, TKey>>;

export type ListingParsed = Omit<
  ProduceListing,
  'id' | 'farmer_id' | 'status' | 'created_at' | 'updated_at' | 'photo_storage_paths'
>;

export type ListingParseResult =
  { ok: true; values: ListingParsed } | { ok: false; errors: ListingErrors };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates every field; errors are i18n keys so the form reads in the farmer's language. */
export function validateListing(input: ListingFormValues): ListingParseResult {
  const errors: ListingErrors = {};

  const title = input.title.trim();
  if (title === '') errors.title = 'error.title';
  if (input.category === '') errors.category = 'error.category';
  const product = input.product_name.trim();
  if (product === '') errors.product_name = 'error.productName';
  const description = input.description.trim();
  if (description === '') errors.description = 'error.description';
  else if (description.length > LISTING_DESCRIPTION_MAX)
    errors.description = 'error.descriptionLong';

  const quantity = Number(input.quantity);
  if (input.quantity.trim() === '' || !Number.isFinite(quantity) || quantity <= 0)
    errors.quantity = 'error.quantity';
  if (input.unit === '') errors.unit = 'error.unit';

  const price = Number(input.price_ssp);
  if (input.price_ssp.trim() === '' || !Number.isFinite(price) || price < 0)
    errors.price_ssp = 'error.price';
  if (input.price_per === '') errors.price_per = 'error.pricePer';

  if (!DATE.test(input.available_from)) errors.available_from = 'error.availableFrom';
  const until = input.available_until.trim();
  if (until !== '' && (!DATE.test(until) || until < input.available_from))
    errors.available_until = 'error.availableUntil';

  const phone = parseSouthSudanMobile(input.contact_phone);
  if (!phone.ok) errors.contact_phone = 'error.contactPhone';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    values: {
      title,
      category: input.category as ListingCategory,
      product_name: product,
      description,
      quantity,
      unit: input.unit as ListingUnit,
      price_ssp: price,
      price_per: input.price_per as ListingUnit,
      negotiable: input.negotiable,
      available_from: input.available_from,
      available_until: until === '' ? null : until,
      harvest_season: input.harvest_season.trim() === '' ? null : input.harvest_season.trim(),
      pickup_notes: input.pickup_notes.trim() === '' ? null : input.pickup_notes.trim(),
      contact_phone: phone.ok ? phone.value : input.contact_phone,
      delivery_available: input.delivery_available,
    },
  };
}
