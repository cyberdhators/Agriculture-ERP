import { describe, expect, it } from 'vitest';

import {
  BUYER_MESSAGES,
  CART_MAX_ITEMS,
  FARMER_ACCOUNT_MESSAGES,
  cartCheckoutSchema,
  farmerAuthIdentifier,
  farmerListingSchema,
  farmerRequestAnswerSchema,
  farmerSelfRegisterSchema,
} from '../src/index';

/** B14 -- farmers hold accounts; buyers send a cart. */

const fieldsOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]));

describe('the farmer sign-in identifier', () => {
  it('is one account per number, whichever way the number is written', () => {
    const a = farmerAuthIdentifier('+211 912 345 678');
    expect(a).toBe('farmer.211912345678@farmers.invalid');
    expect(farmerAuthIdentifier('0912345678')).toBe(a);
    expect(farmerAuthIdentifier('211-912-345-678')).toBe(a);
  });

  it('never addresses a deliverable domain', () => {
    expect(farmerAuthIdentifier('0912345678').endsWith('.invalid')).toBe(true);
  });

  it('refuses a number that is not a South Sudan mobile', () => {
    expect(() => farmerAuthIdentifier('12345')).toThrow();
  });
});

describe('farmer self-registration', () => {
  const valid = () => ({
    given_name: 'Demo',
    family_name: 'Farmer',
    sex: 'f',
    year_of_birth: 1990,
    phone: '+211912345678',
    password: 'maize1',
    confirm_password: 'maize1',
    payam_id: 'CES-JUB-KAT',
    village: 'Kator',
    consent: { text_version: 'v1.2-en', language: 'en', granted: true },
  });

  it('accepts the short form: name, phone, place, village, password and consent', () => {
    const result = farmerSelfRegisterSchema.safeParse(valid());
    expect(result.success).toBe(true);
    expect(result.data?.primary_crops).toEqual([]);
    expect(result.data?.services_wanted).toEqual([]);
  });

  it('accepts the optional farm answers from CORWADO’s form', () => {
    const result = farmerSelfRegisterSchema.safeParse({
      ...valid(),
      primary_crops: ['maize', 'sorghum'],
      land_size: 2.5,
      land_unit: 'feddan',
      land_tenure: 'owned',
      years_farming: 10,
      group_member: true,
      group_name: 'Kator Farmers',
      has_whatsapp: true,
      heard_via: 'cooperative',
      services_wanted: ['buyers', 'transport'],
    });
    expect(result.success).toBe(true);
  });

  it('takes a six-character password (B12), and refuses five', () => {
    expect(
      fieldsOf(
        farmerSelfRegisterSchema.safeParse({
          ...valid(),
          password: 'abcde',
          confirm_password: 'abcde',
        }),
      ),
    ).toMatchObject({ password: FARMER_ACCOUNT_MESSAGES.passwordTooShort });
  });

  it('refuses two passwords that differ', () => {
    expect(
      fieldsOf(farmerSelfRegisterSchema.safeParse({ ...valid(), confirm_password: 'other1' })),
    ).toMatchObject({ confirm_password: BUYER_MESSAGES.passwordsDiffer });
  });

  it('requires the village', () => {
    const rest: Record<string, unknown> = { ...valid() };
    delete rest.village;
    expect(farmerSelfRegisterSchema.safeParse(rest).success).toBe(false);
  });

  it('refuses an answer that is not on the form’s list', () => {
    expect(
      fieldsOf(farmerSelfRegisterSchema.safeParse({ ...valid(), land_tenure: 'borrowed' })),
    ).toMatchObject({ land_tenure: FARMER_ACCOUNT_MESSAGES.tenureRequired });
  });

  it('refuses a field the form does not have', () => {
    expect(farmerSelfRegisterSchema.safeParse({ ...valid(), bank_account: '123' }).success).toBe(
      false,
    );
  });
});

describe('a farmer’s own listing', () => {
  const valid = () => ({
    trading_name: 'Demo Farm',
    title: 'White maize, dry',
    category: 'crop',
    product_name: 'Maize',
    quantity: 500,
    unit: 'kg',
    price_ssp: 1200,
    price_per: 'kg',
    available_from: '2026-10-07',
    status: 'listed',
  });

  it('accepts a listing the farmer publishes', () => {
    expect(farmerListingSchema.safeParse(valid()).success).toBe(true);
  });

  it('refuses a minimum order larger than the quantity', () => {
    expect(
      fieldsOf(farmerListingSchema.safeParse({ ...valid(), min_order_quantity: 900 })),
    ).toMatchObject({ min_order_quantity: FARMER_ACCOUNT_MESSAGES.minOrderTooLarge });
  });
});

describe('the farmer’s answer to a request', () => {
  it('is accept or decline, nothing else', () => {
    expect(farmerRequestAnswerSchema.safeParse({ answer: 'accept' }).success).toBe(true);
    expect(farmerRequestAnswerSchema.safeParse({ answer: 'decline' }).success).toBe(true);
    expect(fieldsOf(farmerRequestAnswerSchema.safeParse({ answer: 'maybe' }))).toMatchObject({
      answer: FARMER_ACCOUNT_MESSAGES.answerUnknown,
    });
  });
});

describe('the cart', () => {
  const item = (n: number) => ({
    listing_id: `0b9c6a52-6b1e-4d8e-9a43-${String(n).padStart(12, '0')}`,
    quantity: 100,
    unit: 'kg',
  });

  it('sends products from several farmers together', () => {
    const result = cartCheckoutSchema.safeParse({
      items: [item(1), item(2), item(3)],
      delivery_location: 'Juba',
    });
    expect(result.success).toBe(true);
  });

  it('refuses an empty cart', () => {
    expect(
      fieldsOf(cartCheckoutSchema.safeParse({ items: [], delivery_location: 'Juba' })),
    ).toMatchObject({ items: BUYER_MESSAGES.cartEmpty });
  });

  it(`refuses more than ${CART_MAX_ITEMS} products`, () => {
    const items = Array.from({ length: CART_MAX_ITEMS + 1 }, (_, i) => item(i));
    expect(
      fieldsOf(cartCheckoutSchema.safeParse({ items, delivery_location: 'Juba' })),
    ).toMatchObject({ items: BUYER_MESSAGES.cartTooLarge });
  });
});
