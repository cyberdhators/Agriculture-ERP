import { describe, expect, it } from 'vitest';

import { PHONE_MESSAGES, phoneSchema } from '../src/index';

/**
 * Every phone number in this file is FABRICATED. None of them belongs to a
 * real person. They are structurally valid South Sudan mobile numbers and
 * nothing more. Real farmer data exists in production only -- CLAUDE.md,
 * "Personal data".
 */

const accepted = (input: unknown): string => {
  const result = phoneSchema.safeParse(input);
  expect(result.success, `expected ${JSON.stringify(input)} to be accepted`).toBe(true);
  if (!result.success) throw new Error('unreachable');
  return result.data;
};

const refused = (input: unknown): string => {
  const result = phoneSchema.safeParse(input);
  expect(result.success, `expected ${JSON.stringify(input)} to be refused`).toBe(false);
  if (result.success) throw new Error('unreachable');
  return result.error.issues[0]?.message ?? '';
};

describe('a South Sudan mobile number that should be accepted', () => {
  it('accepts a number already written in full international form', () => {
    expect(accepted('+211912345678')).toBe('+211912345678');
  });

  it('stores a number written with spaces without them', () => {
    expect(accepted('+211 91 234 5678')).toBe('+211912345678');
  });

  it('stores a number written with hyphens without them', () => {
    expect(accepted('+211-91-234-5678')).toBe('+211912345678');
  });

  it('stores a number written with both spaces and hyphens without them', () => {
    expect(accepted('+211 91-234 5678')).toBe('+211912345678');
  });

  it('turns a local number beginning with zero into an international one', () => {
    expect(accepted('0912345678')).toBe('+211912345678');
  });

  it('accepts a number written without the plus sign', () => {
    expect(accepted('211912345678')).toBe('+211912345678');
  });

  it('ignores spaces typed before or after the number', () => {
    expect(accepted('  +211912345678  ')).toBe('+211912345678');
  });

  it('accepts a second, different number written in local form', () => {
    expect(accepted('0987654321')).toBe('+211987654321');
  });
});

describe('a mobile number that should be refused', () => {
  it('refuses a number with too few digits', () => {
    expect(refused('+21191234567')).toBe(PHONE_MESSAGES.tooFew);
  });

  it('refuses a number with too many digits', () => {
    expect(refused('+2119123456789')).toBe(PHONE_MESSAGES.tooMany);
  });

  it('refuses a number that is only the country code', () => {
    expect(refused('+211')).toBe(PHONE_MESSAGES.tooFew);
  });

  it('refuses a number containing a letter', () => {
    expect(refused('+21191234567a')).toBe(PHONE_MESSAGES.letters);
  });

  it('refuses an entry that is entirely letters', () => {
    expect(refused('not a phone number')).toBe(PHONE_MESSAGES.letters);
  });

  it('refuses an empty entry', () => {
    expect(refused('')).toBe(PHONE_MESSAGES.required);
  });

  it('refuses an entry containing only spaces', () => {
    expect(refused('     ')).toBe(PHONE_MESSAGES.required);
  });

  it('refuses a missing entry', () => {
    expect(refused(undefined)).toBe(PHONE_MESSAGES.required);
  });

  it('refuses an empty entry sent as null', () => {
    expect(refused(null)).toBe(PHONE_MESSAGES.required);
  });

  it('refuses a number from another country', () => {
    expect(refused('+254712345678')).toBe(PHONE_MESSAGES.wrongCountry);
  });

  it('refuses a number with no country code at all', () => {
    expect(refused('912345678')).toBe(PHONE_MESSAGES.wrongCountry);
  });

  it('refuses a number written with brackets', () => {
    expect(refused('+211(91)2345678')).toBe(PHONE_MESSAGES.punctuation);
  });

  it('refuses a number written with full stops', () => {
    expect(refused('+211.91.234.5678')).toBe(PHONE_MESSAGES.punctuation);
  });

  it('refuses a plus sign that is not at the beginning', () => {
    expect(refused('211+912345678')).toBe(PHONE_MESSAGES.punctuation);
  });

  it('refuses a number sent as a plain number rather than text', () => {
    expect(refused(211912345678)).toBe(PHONE_MESSAGES.required);
  });
});
