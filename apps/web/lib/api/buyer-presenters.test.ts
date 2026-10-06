import { describe, expect, it } from 'vitest';

import {
  BUYER_NOTICES,
  MARKET_COLUMNS,
  ORDER_COLUMNS,
  presentDeliveryUpdate,
  presentMarketListing,
  presentOrder,
  type MarketRow,
  type OrderRow,
} from './buyer-presenters';

/**
 * C-14B.8, PROVED ON THE SHAPE: a buyer never receives a farmer's identity.
 *
 * Each presenter is handed a row that carries every sensitive column a careless
 * query might one day select, and must return none of them. That is the
 * property that matters -- not that today's query happens to omit them, but
 * that widening the query tomorrow still leaks nothing.
 */

const NEVER_TO_A_BUYER = [
  'farmer_id',
  'contact_phone',
  'pickup_notes',
  'photo_storage_paths',
  'given_name',
  'family_name',
  'national_id',
  'phone',
  'year_of_birth',
  'sex',
  'boundary',
  'centroid',
  'payam_id',
  'registered_by',
  'caseload_officer_id',
  'created_by',
  'recorded_by_user',
  'recorded_by_buyer',
];

/** Every key at every depth of a presented object. */
const allKeys = (value: unknown, out: string[] = []): string[] => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
};

const SENSITIVE_EXTRAS = {
  farmer_id: '11111111-1111-4111-8111-111111111111',
  contact_phone: '+211912345678',
  pickup_notes: 'Call +211912345678 at the gate',
  photo_storage_paths: ['farmers/1111/photo.jpg'],
  given_name: 'Private',
  family_name: 'Person',
  national_id: 'AB123456',
  year_of_birth: 1980,
  sex: 'f',
  boundary: '{"type":"Polygon"}',
  payam_id: 'CE-JUB-MUN',
};

const marketRow = (): MarketRow =>
  ({
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Maize, dry',
    category: 'crop',
    product_name: 'Maize',
    description: 'Sun-dried.',
    quantity: '2000.00',
    unit: 'kg',
    price_ssp: '850.00',
    price_per: 'kg',
    negotiable: true,
    delivery_available: false,
    available_from: '2026-10-01',
    available_until: null,
    harvest_season: '2026-main',
    quality_grade: 'a',
    min_order_quantity: '100.00',
    trading_name: 'Green Valley Produce',
    updated_at: new Date('2026-10-05T10:00:00Z'),
    supplier_verification: 'verified',
    payam_name: 'Munuki',
    county_id: 'CE-JUB',
    county_name: 'Juba',
    state_id: 'CE',
    state_name: 'Central Equatoria',
    ...SENSITIVE_EXTRAS,
  }) as unknown as MarketRow;

describe('the marketplace listing a buyer receives', () => {
  it('carries none of the farmer’s identifying fields, even when the row does', () => {
    const keys = allKeys(presentMarketListing(marketRow()));
    for (const key of NEVER_TO_A_BUYER) expect(keys, `leaked ${key}`).not.toContain(key);
  });

  it('carries no phone-shaped value anywhere', () => {
    expect(JSON.stringify(presentMarketListing(marketRow()))).not.toMatch(/\+211\d{9}/);
  });

  it('describes the supplier by trading name, standing and location only', () => {
    const presented = presentMarketListing(marketRow());
    expect(presented.supplier).toEqual({ trading_name: 'Green Valley Produce', verified: true });
    expect(presented.location).toEqual({
      payam: 'Munuki',
      county_id: 'CE-JUB',
      county: 'Juba',
      state_id: 'CE',
      state: 'Central Equatoria',
    });
  });

  it('converts figures to numbers and keeps an absent minimum order absent', () => {
    const presented = presentMarketListing({ ...marketRow(), min_order_quantity: null });
    expect(presented.available_quantity).toBe(2000);
    expect(presented.indicative_price_ssp).toBe(850);
    expect(presented.min_order_quantity).toBeNull();
  });

  it('the query itself selects none of the sensitive columns', () => {
    for (const column of ['farmer_id', 'contact_phone', 'pickup_notes', 'photo_storage_paths']) {
      expect(MARKET_COLUMNS).not.toMatch(new RegExp(`\\b${column}\\b`));
    }
  });
});

describe('the order a buyer receives', () => {
  const orderRow = (): OrderRow =>
    ({
      id: '33333333-3333-4333-8333-333333333333',
      order_number: 'PO-000001',
      purchase_request_id: null,
      listing_id: '22222222-2222-4222-8222-222222222222',
      category: 'crop',
      product_name: 'Maize',
      quantity: '500.00',
      unit: 'kg',
      unit_price_ssp: '800.00',
      total_ssp: '400000.00',
      status: 'confirmed',
      delivery_location: 'Juba',
      expected_delivery_date: '2026-11-01',
      cancel_reason: null,
      created_at: new Date('2026-10-05T10:00:00Z'),
      updated_at: new Date('2026-10-05T10:00:00Z'),
      supplier_name: 'Green Valley Produce',
      supplier_county: 'Juba',
      supplier_state: 'Central Equatoria',
      ...SENSITIVE_EXTRAS,
    }) as unknown as OrderRow;

  it('never names the farmer behind the listing', () => {
    const keys = allKeys(presentOrder(orderRow()));
    for (const key of NEVER_TO_A_BUYER) expect(keys, `leaked ${key}`).not.toContain(key);
    expect(ORDER_COLUMNS).not.toMatch(/\bo\.farmer_id\b/);
  });

  it('reports the database total, not one computed here', () => {
    expect(presentOrder(orderRow()).total_ssp).toBe(400000);
  });
});

describe('a delivery timeline entry', () => {
  it('names the recorder as CORWADO or the buyer, never by id', () => {
    const entry = presentDeliveryUpdate({
      id: '44444444-4444-4444-8444-444444444444',
      order_id: '33333333-3333-4333-8333-333333333333',
      status: 'in_transit',
      note: 'Left Juba at 08:00',
      by_buyer: false,
      occurred_at: new Date('2026-10-06T08:00:00Z'),
      ...({ recorded_by_user: '55555555-5555-4555-8555-555555555555' } as object),
    } as never);
    expect(entry.recorded_by).toBe('corwado');
    expect(allKeys(entry)).not.toContain('recorded_by_user');
  });
});

describe('the notices a buyer is sent', () => {
  it('are fixed sentences with nothing interpolated', () => {
    for (const { title, body } of Object.values(BUYER_NOTICES)) {
      expect(title + body).not.toMatch(/\$\{|\{\w+\}|\+211/);
    }
  });
});
