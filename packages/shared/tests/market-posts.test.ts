import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VALIDITY_DAYS,
  FARMER_LISTING_STATUSES,
  MARKET_POST_MESSAGES,
  addDays,
  buyingRequestFilterSchema,
  buyingRequestPatchSchema,
  buyingRequestSchema,
  buyerServiceListingSchema,
  canMove,
  canonicalStatus,
  defaultEndDate,
  farmerListingPatchSchema,
  farmerServiceListingSchema,
  lifecycleActions,
  lifecycleStage,
  listingSaleSchema,
  listingStoredStatus,
  serviceListingPatchSchema,
  serviceListingSchema,
  servicePosterIssue,
} from '../src/index';

/**
 * LISTINGS LANE (2026-10-19). The marketplace lifecycle, buying requests and
 * service listings, proved on the shared schemas and rules alone.
 */

const TODAY = '2026-10-19';
const reasons = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? [] : (result.error?.issues.map((i) => i.message) ?? []);

describe('the lifecycle', () => {
  it('reads the stored produce words in the canonical vocabulary, legacy sold included', () => {
    expect(canonicalStatus('listed')).toBe('active');
    expect(canonicalStatus('sold')).toBe('completed');
    expect(canonicalStatus('completed')).toBe('completed');
    expect(canonicalStatus('paused')).toBe('paused');
    expect(canonicalStatus('withdrawn')).toBe('withdrawn');
    expect(canonicalStatus('draft')).toBe('draft');
    expect(listingStoredStatus('active')).toBe('listed');
    expect(listingStoredStatus('paused')).toBe('paused');
  });

  it('computes expired from the end date, only for something active', () => {
    expect(lifecycleStage('listed', '2026-10-18', TODAY)).toBe('expired');
    expect(lifecycleStage('listed', TODAY, TODAY)).toBe('active');
    expect(lifecycleStage('listed', null, TODAY)).toBe('active');
    expect(lifecycleStage('active', '2026-01-01', TODAY)).toBe('expired');
    expect(lifecycleStage('paused', '2026-01-01', TODAY)).toBe('paused');
    expect(lifecycleStage('sold', '2026-01-01', TODAY)).toBe('completed');
  });

  it('allows the owner moves and refuses the rest; withdrawn and completed are final', () => {
    expect(canMove('draft', 'listed')).toBe(true);
    expect(canMove('listed', 'paused')).toBe(true);
    expect(canMove('paused', 'listed')).toBe(true);
    expect(canMove('paused', 'completed')).toBe(true);
    expect(canMove('active', 'withdrawn')).toBe(true);
    expect(canMove('draft', 'paused')).toBe(false);
    expect(canMove('draft', 'completed')).toBe(false);
    expect(canMove('withdrawn', 'listed')).toBe(false);
    expect(canMove('sold', 'listed')).toBe(false);
    expect(canMove('completed', 'paused')).toBe(false);
    // An unchanged status is not a move, so a full-listing save still works.
    expect(canMove('withdrawn', 'withdrawn')).toBe(true);
    expect(canMove('sold', 'completed')).toBe(true);
  });

  it('offers the actions that fit the stage, with sales for produce only', () => {
    expect(lifecycleActions('draft')).toEqual(['publish', 'withdraw']);
    expect(lifecycleActions('active', { sales: true })).toContain('record_sale');
    expect(lifecycleActions('active')).not.toContain('record_sale');
    expect(lifecycleActions('expired')[0]).toBe('renew');
    expect(lifecycleActions('paused')[0]).toBe('resume');
    expect(lifecycleActions('withdrawn')).toEqual([]);
    expect(lifecycleActions('completed')).toEqual([]);
  });

  it('defaults the end date to thirty days from the later of the start and today', () => {
    expect(DEFAULT_VALIDITY_DAYS).toBe(30);
    expect(addDays('2026-10-19', 30)).toBe('2026-11-18');
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14');
    expect(defaultEndDate(null, '2026-10-01', TODAY)).toBe('2026-11-18');
    expect(defaultEndDate(undefined, '2026-11-01', TODAY)).toBe('2026-12-01');
    expect(defaultEndDate('2026-10-25', '2026-10-01', TODAY)).toBe('2026-10-25');
  });
});

describe('a produce listing', () => {
  it('accepts paused and completed, and still accepts the legacy sold', () => {
    expect(FARMER_LISTING_STATUSES).toEqual(
      expect.arrayContaining(['draft', 'listed', 'paused', 'withdrawn', 'completed', 'sold']),
    );
    expect(farmerListingPatchSchema.safeParse({ status: 'paused' }).success).toBe(true);
    expect(farmerListingPatchSchema.safeParse({ status: 'expired' }).success).toBe(false);
  });

  it('records a sale of a positive quantity, optionally closing the listing', () => {
    expect(listingSaleSchema.parse({ quantity: 3 })).toEqual({ quantity: 3, close: false });
    expect(listingSaleSchema.parse({ quantity: 1.5, close: true }).close).toBe(true);
    expect(reasons(listingSaleSchema.safeParse({ quantity: 0 }))).toContain(
      MARKET_POST_MESSAGES.saleQuantityInvalid,
    );
    expect(listingSaleSchema.safeParse({ quantity: 2, farmer_id: 'x' }).success).toBe(false);
  });
});

const request = {
  display_name: 'Juba Grain Traders',
  category: 'crop',
  product_name: 'Sorghum',
  quantity: 40,
  unit: 'bag_100kg',
  state_id: 'CE',
  location: 'Konyokonyo market, Juba',
  needed_by: '2026-11-30',
};

describe('a buying request', () => {
  it('is published by default and negotiable unless a price is given', () => {
    const parsed = buyingRequestSchema.parse(request);
    expect(parsed.status).toBe('active');
    expect(parsed.negotiable).toBe(true);
  });

  it('never carries who posted it: the poster comes from the session', () => {
    for (const key of ['poster_type', 'farmer_id', 'buyer_id']) {
      expect(buyingRequestSchema.safeParse({ ...request, [key]: 'x' }).success).toBe(false);
    }
  });

  it('needs a unit with a price', () => {
    expect(reasons(buyingRequestSchema.safeParse({ ...request, price_ssp: 30000 }))).toContain(
      MARKET_POST_MESSAGES.priceUnitRequired,
    );
    expect(
      buyingRequestSchema.safeParse({ ...request, price_ssp: 30000, price_per: 'bag_100kg' })
        .success,
    ).toBe(true);
  });

  it('refuses a short location, a bad date and a status a new request cannot have', () => {
    expect(reasons(buyingRequestSchema.safeParse({ ...request, location: 'J' }))).toContain(
      MARKET_POST_MESSAGES.locationInvalid,
    );
    expect(
      reasons(buyingRequestSchema.safeParse({ ...request, needed_by: '30/11/2026' })),
    ).toContain(MARKET_POST_MESSAGES.dateInvalid);
    expect(buyingRequestSchema.safeParse({ ...request, status: 'paused' }).success).toBe(false);
  });

  it('changes only what is sent, and a change of nothing is refused', () => {
    const patch = buyingRequestPatchSchema.parse({ status: 'paused' });
    expect(patch).toEqual({ status: 'paused' });
    expect(buyingRequestPatchSchema.safeParse({}).success).toBe(false);
    expect(buyingRequestPatchSchema.safeParse({ needed_by: '2026-12-31' }).success).toBe(true);
  });

  it('filters by poster type and refuses an unknown one', () => {
    expect(buyingRequestFilterSchema.safeParse({ poster: 'buyer', q: 'maize' }).success).toBe(true);
    expect(reasons(buyingRequestFilterSchema.safeParse({ poster: 'staff' }))).toContain(
      MARKET_POST_MESSAGES.posterUnknown,
    );
    expect(buyingRequestFilterSchema.safeParse({ verified: 'true' }).success).toBe(false);
  });
});

const service = {
  trading_name: 'Lado Tractor Hire',
  service_type: 'tractor_hire',
  title: 'Ploughing with a 75 hp tractor',
  description: 'Ploughing and harrowing, driver included.',
  location: 'Yei town and nearby payams',
  available_from: '2026-10-20',
  price_ssp: 45000,
  price_unit: 'per_feddan',
};

describe('a service listing', () => {
  it('is a draft by default, with no stock', () => {
    const parsed = serviceListingSchema.parse(service);
    expect(parsed.status).toBe('draft');
    expect('quantity' in parsed).toBe(false);
  });

  it('needs a price or negotiable, and a unit with a price', () => {
    expect(reasons(serviceListingSchema.safeParse({ ...service, price_ssp: undefined }))).toContain(
      MARKET_POST_MESSAGES.priceOrNegotiable,
    );
    expect(
      serviceListingSchema.safeParse({ ...service, price_ssp: undefined, negotiable: true })
        .success,
    ).toBe(true);
    expect(
      reasons(serviceListingSchema.safeParse({ ...service, price_unit: undefined })),
    ).toContain(MARKET_POST_MESSAGES.priceUnitRequired);
  });

  it('refuses an unknown service type and an end before the start', () => {
    expect(
      reasons(serviceListingSchema.safeParse({ ...service, service_type: 'loans' })),
    ).toContain(MARKET_POST_MESSAGES.serviceTypeUnknown);
    expect(
      reasons(serviceListingSchema.safeParse({ ...service, available_until: '2026-10-01' })),
    ).toContain(MARKET_POST_MESSAGES.untilBeforeFrom);
  });

  it('never carries an owner or a payam: the session names the owner', () => {
    for (const key of ['farmer_id', 'buyer_id', 'poster_type', 'payam_id']) {
      expect(serviceListingSchema.safeParse({ ...service, [key]: 'x' }).success).toBe(false);
    }
  });

  it("a farmer's state is the record's, so a farmer may not send one (2026-10-26)", () => {
    expect(farmerServiceListingSchema.safeParse(service).success).toBe(true);
    expect(
      reasons(farmerServiceListingSchema.safeParse({ ...service, state_id: 'SS-CE' })),
    ).toContain(MARKET_POST_MESSAGES.stateFromFarmerRecord);
    expect(servicePosterIssue('farmer', { state_id: 'SS-CE' }, false)?.message).toBe(
      MARKET_POST_MESSAGES.stateFromFarmerRecord,
    );
  });
});

describe("a buyer account's service (2026-10-26)", () => {
  it('must name a state from the list', () => {
    expect(reasons(buyerServiceListingSchema.safeParse(service))).toContain(
      MARKET_POST_MESSAGES.stateUnknown,
    );
    expect(servicePosterIssue('buyer', {}, true)).toEqual({
      field: 'state_id',
      message: MARKET_POST_MESSAGES.stateUnknown,
    });
    const parsed = buyerServiceListingSchema.parse({ ...service, state_id: 'SS-CE' });
    expect(parsed.state_id).toBe('SS-CE');
    expect(parsed.status).toBe('draft');
  });

  it('keeps every other rule a farmer has', () => {
    expect(
      reasons(
        buyerServiceListingSchema.safeParse({
          ...service,
          state_id: 'SS-CE',
          price_ssp: undefined,
        }),
      ),
    ).toContain(MARKET_POST_MESSAGES.priceOrNegotiable);
  });

  it('a change need not repeat the state, and may move it', () => {
    expect(servicePosterIssue('buyer', {}, false)).toBeNull();
    expect(serviceListingPatchSchema.parse({ state_id: 'SS-CE' })).toEqual({ state_id: 'SS-CE' });
  });

  it('renews with a new date alone', () => {
    expect(serviceListingPatchSchema.parse({ available_until: '2026-12-31' })).toEqual({
      available_until: '2026-12-31',
    });
  });
});

describe('the phone on a post (2026-10-20)', () => {
  it('is off unless the poster ticks it, so messaging is the default', () => {
    expect(buyingRequestSchema.parse(request).show_phone).toBe(false);
    expect(serviceListingSchema.parse(service).show_phone).toBe(false);
    expect(buyingRequestSchema.parse({ ...request, show_phone: true }).show_phone).toBe(true);
  });

  it('is a yes or no, nothing else', () => {
    expect(buyingRequestSchema.safeParse({ ...request, show_phone: 'yes' }).success).toBe(false);
  });

  it('an edit that does not mention it leaves it as it is', () => {
    expect(serviceListingPatchSchema.parse({ title: 'Tractor hire' })).not.toHaveProperty(
      'show_phone',
    );
  });
});
