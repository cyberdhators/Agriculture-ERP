import { describe, expect, it } from 'vitest';

import {
  BUYER_ACCOUNT_TYPES,
  BUYER_ORGANIZATION_TYPES,
  BUYER_VERIFICATION_STATUSES,
  LISTING_CATEGORIES,
  LISTING_GRADES,
  LISTING_UNITS,
  PAYMENT_PREFERENCES,
  PURCHASE_ORDER_STATUSES,
  PURCHASE_REQUEST_STATUSES,
} from '@agri-erp/shared';

import {
  ACCOUNT_TYPE_LABELS,
  CATEGORY_LABELS,
  GRADE_LABELS,
  ORDER_STATUS_LABELS,
  ORG_TYPE_LABELS,
  PAYMENT_LABELS,
  REQUEST_STATUS_LABELS,
  UNIT_LABELS,
  VERIFICATION_LABELS,
  VERIFICATION_MESSAGES,
  MONTH_LABELS,
  categoryLabel,
  formatMonth,
  formatQuantity,
  formatSsp,
  labelOf,
  monthLabels,
  orgTypeLabel,
  paymentLabel,
  unitLabel,
  verificationLabel,
  verificationMessage,
} from './labels';

/** Every stored value has a word, and no word is kept for a value that is gone. */
describe('buyer labels cover exactly the stored values', () => {
  const cases: [string, Record<string, string>, readonly string[]][] = [
    ['category', CATEGORY_LABELS, LISTING_CATEGORIES],
    ['unit', UNIT_LABELS, LISTING_UNITS],
    ['grade', GRADE_LABELS, LISTING_GRADES],
    ['organisation type', ORG_TYPE_LABELS, BUYER_ORGANIZATION_TYPES],
    ['payment preference', PAYMENT_LABELS, PAYMENT_PREFERENCES],
    ['verification', VERIFICATION_LABELS, BUYER_VERIFICATION_STATUSES],
    ['verification message', VERIFICATION_MESSAGES, BUYER_VERIFICATION_STATUSES],
    ['account type', ACCOUNT_TYPE_LABELS, BUYER_ACCOUNT_TYPES],
    ['request status', REQUEST_STATUS_LABELS, PURCHASE_REQUEST_STATUSES],
    ['order status', ORDER_STATUS_LABELS, PURCHASE_ORDER_STATUSES],
  ];
  it.each(cases)('%s', (_name, table, values) => {
    expect(Object.keys(table).sort()).toEqual([...values].sort());
    for (const label of Object.values(table)) expect(label.trim()).not.toBe('');
  });

  it('an unknown value prints as itself, and null as a dash, never blank', () => {
    expect(labelOf(UNIT_LABELS, 'tonne')).toBe('tonne');
    expect(labelOf(UNIT_LABELS, null)).toBe('—');
  });

  it('the under-review message says so in plain words', () => {
    expect(VERIFICATION_MESSAGES.under_review).toMatch(/currently under review/);
  });

  it('an individual is never labelled verified: nobody reviewed them', () => {
    expect(VERIFICATION_LABELS.not_required).not.toMatch(/verif/i);
  });
});

describe('figures', () => {
  it('names the currency and groups thousands', () => {
    expect(formatSsp(425000)).toBe('SSP 425,000');
  });

  it('writes a weight as a weight and a count of bags as a count', () => {
    expect(formatQuantity(5000, 'kg')).toBe('5,000 kg');
    expect(formatQuantity(12, 'bag_50kg')).toBe('12 × 50 kg bag');
  });

  it('formats a month key for a chart axis', () => {
    expect(formatMonth('2026-10')).toBe('Oct 2026');
  });
});

/**
 * 2026-10-29 (Arabic for the email side): the buyer screens read these words
 * through lib/i18n in the buyer's language. The English there is exactly the
 * English here, so the staff portal and the buyer read the same word.
 */
describe('the buyer words in both languages', () => {
  it('the i18n English matches the tables, value for value', () => {
    for (const s of BUYER_VERIFICATION_STATUSES) {
      expect(verificationLabel(s, 'en')).toBe(VERIFICATION_LABELS[s]);
      expect(verificationMessage(s, 'en')).toBe(VERIFICATION_MESSAGES[s]);
    }
    for (const o of BUYER_ORGANIZATION_TYPES)
      expect(orgTypeLabel(o, 'en')).toBe(ORG_TYPE_LABELS[o]);
    for (const p of PAYMENT_PREFERENCES) expect(paymentLabel(p, 'en')).toBe(PAYMENT_LABELS[p]);
    for (const c of LISTING_CATEGORIES) expect(categoryLabel(c, 'en')).toBe(CATEGORY_LABELS[c]);
    for (const u of LISTING_UNITS) expect(unitLabel(u, 'en')).toBe(UNIT_LABELS[u]);
    expect(monthLabels('en')).toEqual([...MONTH_LABELS]);
  });

  it('every one has its Arabic', () => {
    const arabic = /[؀-ۿ]/;
    for (const s of BUYER_VERIFICATION_STATUSES) {
      expect(verificationLabel(s, 'ar')).toMatch(arabic);
      expect(verificationMessage(s, 'ar')).toMatch(arabic);
    }
    for (const o of BUYER_ORGANIZATION_TYPES) expect(orgTypeLabel(o, 'ar')).toMatch(arabic);
    for (const p of PAYMENT_PREFERENCES) expect(paymentLabel(p, 'ar')).toMatch(arabic);
    for (const c of LISTING_CATEGORIES) expect(categoryLabel(c, 'ar')).toMatch(arabic);
    for (const m of monthLabels('ar')) expect(m).toMatch(arabic);
  });
});
