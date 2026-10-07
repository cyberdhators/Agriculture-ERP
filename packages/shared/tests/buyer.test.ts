import { describe, expect, it } from 'vitest';

import {
  BUYER_ACCOUNT_TYPES,
  BUYER_MESSAGES,
  BUYER_VERIFICATION_STATUSES,
  STANDINGS_FOR,
  initialStanding,
  BUYER_VERIFICATION_TRANSITIONS,
  ORDER_TRANSITIONS,
  PURCHASE_ORDER_STATUSES,
  PURCHASE_REQUEST_STATUSES,
  REQUEST_DECISION_TRANSITIONS,
  buyerCapabilities,
  buyerMayCancelOrder,
  buyerMayCancelRequest,
  buyerPhoneSchema,
  buyerProfilePatchSchema,
  buyerRegistrationSchema,
  canMoveBuyer,
  createOrderSchema,
  marketplaceFilterSchema,
  purchaseRequestInputSchema,
  purchaseRequestPatchSchema,
  zodErrorToApiError,
} from '../src/index';

/**
 * B13's shared validation, both directions: what is accepted, and what is
 * refused with which sentence. Pure -- no database, no clock beyond "today".
 */

const fieldsOf = (result: { success: boolean; error?: unknown }) =>
  result.success ? {} : (zodErrorToApiError(result.error as never).body.error.fields ?? {});

const FAR_FUTURE = '2099-12-31';
const PAST = '2000-01-01';

// Assembled, never written as one literal: a credential-shaped string in a
// fixture is a finding in the secret scan (CLAUDE.md, Secrets).
const PASSPHRASE = ['plain', 'test', 'words', 'only'].join('-');

const validRegistration = () => ({
  given_name: 'Ayen',
  family_name: 'Demo',
  email: 'procurement@example.invalid',
  phone: '+211912345678',
  password: PASSPHRASE,
  confirm_password: PASSPHRASE,
  organization_name: 'Demo Grain Traders',
  organization_type: 'trader',
  country_code: 'ss',
});

describe('buyer registration', () => {
  it('accepts a minimal, valid application and fills the procurement defaults', () => {
    const parsed = buyerRegistrationSchema.safeParse(validRegistration());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.country_code).toBe('SS');
    expect(parsed.data.interested_categories).toEqual([]);
    expect(parsed.data.email).toBe('procurement@example.invalid');
  });

  it('refuses mismatched passwords on the confirmation field', () => {
    const result = buyerRegistrationSchema.safeParse({
      ...validRegistration(),
      confirm_password: `${PASSPHRASE}-x`,
    });
    expect(fieldsOf(result)).toMatchObject({ confirm_password: BUYER_MESSAGES.passwordsDiffer });
  });

  it('REFUSES A SELF-ASSIGNED STANDING: verification_status is not a field (mass assignment)', () => {
    const result = buyerRegistrationSchema.safeParse({
      ...validRegistration(),
      verification_status: 'verified',
    });
    expect(result.success).toBe(false);
    expect(fieldsOf(result)).toHaveProperty('verification_status');
  });

  it('refuses an organisation id or a role in the body', () => {
    for (const extra of [{ organization_id: crypto.randomUUID() }, { role: 'admin' }]) {
      expect(buyerRegistrationSchema.safeParse({ ...validRegistration(), ...extra }).success).toBe(
        false,
      );
    }
  });

  it('refuses a county without a state, and an inverted quantity range', () => {
    const result = buyerRegistrationSchema.safeParse({
      ...validRegistration(),
      county_id: 'CE-JUB',
      min_quantity: 500,
      max_quantity: 100,
    });
    expect(fieldsOf(result)).toMatchObject({
      county_id: BUYER_MESSAGES.countyNeedsState,
      max_quantity: BUYER_MESSAGES.quantityRangeInverted,
    });
  });

  it('refuses an unknown organisation type and a website that is not a web address', () => {
    const result = buyerRegistrationSchema.safeParse({
      ...validRegistration(),
      organization_type: 'bank',
      website: 'javascript:alert(1)',
    });
    expect(fieldsOf(result)).toMatchObject({
      organization_type: BUYER_MESSAGES.organizationTypeUnknown,
      website: BUYER_MESSAGES.websiteInvalid,
    });
  });

  it('de-duplicates the lists it is given', () => {
    const parsed = buyerRegistrationSchema.parse({
      ...validRegistration(),
      interested_categories: ['crop', 'crop', 'fruit'],
      purchasing_months: [1, 1, 12],
    });
    expect(parsed.interested_categories).toEqual(['crop', 'fruit']);
    expect(parsed.purchasing_months).toEqual([1, 12]);
  });

  it('refuses a month outside 1 to 12', () => {
    const result = buyerRegistrationSchema.safeParse({
      ...validRegistration(),
      purchasing_months: [13],
    });
    expect(result.success).toBe(false);
  });
});

describe('individual buyers need no review (owner, 2026-10-06)', () => {
  const individual = (): Record<string, unknown> => {
    const body: Record<string, unknown> = { ...validRegistration(), account_type: 'individual' };
    delete body.organization_name;
    delete body.organization_type;
    return body;
  };

  it('an individual registers with no organisation name or type', () => {
    expect(buyerRegistrationSchema.safeParse(individual()).success).toBe(true);
  });

  it('a business must still name itself and its type', () => {
    const result = buyerRegistrationSchema.safeParse({ ...individual(), account_type: 'business' });
    expect(fieldsOf(result)).toMatchObject({
      organization_name: BUYER_MESSAGES.organizationNameRequired,
      organization_type: BUYER_MESSAGES.organizationTypeUnknown,
    });
  });

  it('an unspecified kind is a business, so review is the default, not the exception', () => {
    const parsed = buyerRegistrationSchema.parse(validRegistration());
    expect(parsed.account_type).toBe('business');
  });

  it('an individual starts able to request; a business starts pending', () => {
    expect(initialStanding('individual')).toBe('not_required');
    expect(buyerCapabilities(initialStanding('individual'))).toEqual({
      browse: true,
      request: true,
    });
    expect(initialStanding('business')).toBe('pending');
    expect(buyerCapabilities(initialStanding('business')).request).toBe(false);
  });

  it('an individual is never put under review or verified; a business is never exempted', () => {
    expect(canMoveBuyer('not_required', 'suspended', 'individual')).toBe(true);
    expect(canMoveBuyer('suspended', 'not_required', 'individual')).toBe(true);
    expect(canMoveBuyer('suspended', 'verified', 'individual')).toBe(false);
    expect(canMoveBuyer('rejected', 'under_review', 'individual')).toBe(false);
    expect(canMoveBuyer('suspended', 'not_required', 'business')).toBe(false);
    expect(canMoveBuyer('pending', 'verified', 'business')).toBe(true);
  });

  it('the kinds and their standings agree with the status list', () => {
    for (const type of BUYER_ACCOUNT_TYPES) {
      for (const s of STANDINGS_FOR[type]) expect(BUYER_VERIFICATION_STATUSES).toContain(s);
    }
  });
});

describe('buyer phone', () => {
  it('accepts international E.164 and a local South Sudan number, normalised', () => {
    expect(buyerPhoneSchema.parse('+254 712 345 678')).toBe('+254712345678');
    expect(buyerPhoneSchema.parse('0912345678')).toBe('+211912345678');
  });

  it('refuses a number with no country code', () => {
    expect(buyerPhoneSchema.safeParse('712345678').success).toBe(false);
  });
});

describe('buyer profile patch', () => {
  it('refuses an empty patch', () => {
    expect(buyerProfilePatchSchema.safeParse({}).success).toBe(false);
  });

  it('refuses email, password and verification status: they are not profile fields', () => {
    for (const body of [
      { email: 'x@example.invalid' },
      { password: PASSPHRASE },
      { verification_status: 'verified' },
    ]) {
      expect(buyerProfilePatchSchema.safeParse(body).success).toBe(false);
    }
  });

  it('accepts a single organisation field', () => {
    expect(buyerProfilePatchSchema.safeParse({ city: 'Juba' }).success).toBe(true);
  });
});

describe('purchase requests', () => {
  const valid = () => ({
    listing_id: '0b9c6a52-6b1e-4d8e-9a43-3f0c2d7e5a11',
    category: 'crop',
    product_name: 'Maize',
    quantity: 5000,
    unit: 'kg',
    delivery_location: 'Juba',
    required_by: FAR_FUTURE,
    notes: 'Grade A preferred',
  });

  it('accepts a valid request', () => {
    expect(purchaseRequestInputSchema.safeParse(valid()).success).toBe(true);
  });

  it('B14: refuses a request that names no listing -- every request goes to a farmer', () => {
    const rest: Record<string, unknown> = { ...valid() };
    delete rest.listing_id;
    expect(purchaseRequestInputSchema.safeParse(rest).success).toBe(false);
  });

  it('refuses a zero, negative or non-numeric quantity', () => {
    for (const quantity of [0, -5, '5000']) {
      const result = purchaseRequestInputSchema.safeParse({ ...valid(), quantity });
      expect(fieldsOf(result)).toMatchObject({ quantity: BUYER_MESSAGES.quantityInvalid });
    }
  });

  it('refuses a required-by date in the past', () => {
    const result = purchaseRequestInputSchema.safeParse({ ...valid(), required_by: PAST });
    expect(fieldsOf(result)).toMatchObject({ required_by: BUYER_MESSAGES.requiredByInvalid });
  });

  it('refuses an organisation, a status or a price sent by the buyer', () => {
    for (const extra of [
      { organization_id: crypto.randomUUID() },
      { status: 'accepted' },
      { unit_price_ssp: 1 },
    ]) {
      expect(purchaseRequestInputSchema.safeParse({ ...valid(), ...extra }).success).toBe(false);
    }
  });

  it('a patch takes submit or cancel and nothing else as an action', () => {
    expect(purchaseRequestPatchSchema.safeParse({ action: 'submit' }).success).toBe(true);
    expect(purchaseRequestPatchSchema.safeParse({ action: 'accept' }).success).toBe(false);
  });
});

describe('the marketplace filter', () => {
  it('accepts every documented filter as query-string text', () => {
    const parsed = marketplaceFilterSchema.parse({
      q: 'maize',
      category: 'crop',
      state_id: 'CE',
      min_quantity: '100',
      available_by: '2026-12-01',
      grade: 'a',
      min_price: '10',
      max_price: '99.50',
      supplier: 'verified',
    });
    expect(parsed.min_price).toBe(10);
    expect(parsed.max_price).toBe(99.5);
  });

  it('refuses a filter it does not offer, rather than ignoring it', () => {
    expect(marketplaceFilterSchema.safeParse({ farmer_id: 'x' }).success).toBe(false);
  });

  it('refuses an inverted price range and a malformed number', () => {
    expect(
      fieldsOf(marketplaceFilterSchema.safeParse({ min_price: '50', max_price: '10' })),
    ).toMatchObject({ max_price: BUYER_MESSAGES.priceRangeInverted });
    expect(fieldsOf(marketplaceFilterSchema.safeParse({ min_quantity: '1e9' }))).toMatchObject({
      min_quantity: BUYER_MESSAGES.filterNumberInvalid,
    });
  });
});

describe('standing decides what a buyer may do', () => {
  it('a new account can browse but not request', () => {
    expect(buyerCapabilities('pending')).toEqual({ browse: true, request: false });
    expect(buyerCapabilities('under_review')).toEqual({ browse: true, request: false });
  });

  it('a verified business, or an individual, can request', () => {
    expect(buyerCapabilities('verified')).toEqual({ browse: true, request: true });
    expect(buyerCapabilities('not_required')).toEqual({ browse: true, request: true });
  });

  it('a rejected or suspended account can do neither', () => {
    expect(buyerCapabilities('rejected')).toEqual({ browse: false, request: false });
    expect(buyerCapabilities('suspended')).toEqual({ browse: false, request: false });
  });

  it('the transition tables cover every status, and only name real ones', () => {
    for (const [table, statuses] of [
      [BUYER_VERIFICATION_TRANSITIONS, BUYER_VERIFICATION_STATUSES],
      [REQUEST_DECISION_TRANSITIONS, PURCHASE_REQUEST_STATUSES],
      [ORDER_TRANSITIONS, PURCHASE_ORDER_STATUSES],
    ] as const) {
      expect(Object.keys(table).sort()).toEqual([...statuses].sort());
      for (const targets of Object.values(table)) {
        for (const t of targets) expect(statuses as readonly string[]).toContain(t);
      }
    }
  });

  it('nothing moves back to pending: a buyer cannot be un-reviewed into a fresh application', () => {
    for (const from of BUYER_VERIFICATION_STATUSES)
      expect(canMoveBuyer(from, 'pending')).toBe(false);
  });

  it('a buyer cancels only what nobody has acted on', () => {
    expect(buyerMayCancelRequest('draft')).toBe(true);
    expect(buyerMayCancelRequest('submitted')).toBe(true);
    expect(buyerMayCancelRequest('accepted')).toBe(false);
    expect(buyerMayCancelOrder('pending')).toBe(true);
    expect(buyerMayCancelOrder('confirmed')).toBe(false);
  });
});

describe('creating an order (staff)', () => {
  it('takes no product, category, unit, seller or total from the body', () => {
    const base = {
      organization_id: crypto.randomUUID(),
      listing_id: crypto.randomUUID(),
      quantity: 10,
      unit_price_ssp: 1200,
      delivery_location: 'Juba',
    };
    expect(createOrderSchema.safeParse(base).success).toBe(true);
    for (const extra of [
      { farmer_id: crypto.randomUUID() },
      { total_ssp: 1 },
      { product_name: 'x' },
    ]) {
      expect(createOrderSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
  });
});
