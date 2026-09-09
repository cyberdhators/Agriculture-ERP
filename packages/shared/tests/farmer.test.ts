import { describe, expect, it } from 'vitest';
import {
  FARMER_MESSAGES,
  FARMER_NUMBER_PATTERN,
  PHONE_MESSAGES,
  createFarmerSchema,
  farmerFilterSchema,
  formatFarmerNumber,
  nameMatchKey,
  patchFarmerSchema,
  zodErrorToApiError,
} from '../src/index';

const valid = () => ({
  id: '11111111-2222-4333-8444-555555555555',
  given_name: 'Zzachol',
  family_name: 'Zztestfamily',
  sex: 'f',
  year_of_birth: 1990,
  phone: '+211912345678',
  national_id: 'ZZ123456',
  payam_id: 'CE-JUB-MUN',
  consent: { text_version: 'v1.0-en', language: 'en', granted: true },
});

const reasonFor = (body: unknown, field: string): string | undefined => {
  const result = createFarmerSchema.safeParse(body);
  if (result.success) return undefined;
  return zodErrorToApiError(result.error).body.error.fields?.[field];
};

describe('what a farmer registration must look like (C-5.2)', () => {
  it('accepts a complete registration', () => {
    expect(createFarmerSchema.safeParse(valid()).success).toBe(true);
  });
  it('accepts one without consent — a business rule the route answers 422, not 400 here', () => {
    const without: Record<string, unknown> = { ...valid() };
    delete without.consent;
    expect(createFarmerSchema.safeParse(without).success).toBe(true);
  });
  it('a 500-character name is refused, naming the field', () => {
    expect(reasonFor({ ...valid(), given_name: 'a'.repeat(500) }, 'given_name')).toBe(
      FARMER_MESSAGES.nameTooLong,
    );
  });
  it('an emoji name is refused, naming the field', () => {
    expect(reasonFor({ ...valid(), family_name: 'Zztest 🌾' }, 'family_name')).toBe(
      FARMER_MESSAGES.nameNotLetters,
    );
  });
  it('a name in another script, or with combining marks, is accepted', () => {
    expect(createFarmerSchema.safeParse({ ...valid(), given_name: 'أشول' }).success).toBe(true);
    expect(createFarmerSchema.safeParse({ ...valid(), given_name: 'Achôl' }).success).toBe(true);
  });
  it('a year of birth in the future is refused, naming the field', () => {
    const next = new Date().getUTCFullYear() + 1;
    expect(reasonFor({ ...valid(), year_of_birth: next }, 'year_of_birth')).toBe(
      FARMER_MESSAGES.yearInFuture,
    );
  });
  it('more than 120 years back is refused; exactly 120 is accepted', () => {
    const thisYear = new Date().getUTCFullYear();
    expect(reasonFor({ ...valid(), year_of_birth: thisYear - 121 }, 'year_of_birth')).toBe(
      FARMER_MESSAGES.yearTooFarBack,
    );
    expect(
      createFarmerSchema.safeParse({ ...valid(), year_of_birth: thisYear - 120 }).success,
    ).toBe(true);
  });
  it('letters in the phone are refused with the phone rule, naming the field', () => {
    expect(reasonFor({ ...valid(), phone: '+2119123456ab' }, 'phone')).toBe(PHONE_MESSAGES.letters);
  });
  it('a national id outside the reserved shape is refused; null is allowed', () => {
    expect(reasonFor({ ...valid(), national_id: 'abc' }, 'national_id')).toBe(
      FARMER_MESSAGES.nationalIdShape,
    );
    expect(createFarmerSchema.safeParse({ ...valid(), national_id: null }).success).toBe(true);
  });
  it('an unknown field is refused, naming it', () => {
    expect(reasonFor({ ...valid(), nickname: 'x' }, 'nickname')).toBe(
      'This field is not recognised.',
    );
  });
  it('a patch may not carry the identifier, the registering officer or consent', () => {
    for (const key of ['id', 'registered_by', 'consent']) {
      expect(patchFarmerSchema.safeParse({ [key]: 'x' }).success, key).toBe(false);
    }
  });
});

describe('list filters (C-5.7)', () => {
  it('accepts every documented filter', () => {
    expect(
      farmerFilterSchema.safeParse({
        verification_status: 'pending',
        payam: 'CE-JUB-MUN',
        county: 'CE-JUB',
        sex: 'm',
        registered_from: '2026-01-01T00:00:00.000Z',
        registered_to: '2026-12-31T00:00:00.000Z',
        duplicate_flag: 'true',
        limit: '10',
      }).success,
    ).toBe(true);
  });
  it('refuses an inverted date range, naming the end field', () => {
    const result = farmerFilterSchema.safeParse({
      registered_from: '2026-12-31T00:00:00.000Z',
      registered_to: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(zodErrorToApiError(result.error).body.error.fields?.registered_to).toBe(
        FARMER_MESSAGES.filterRangeInverted,
      );
    }
  });
});

describe('the farmer number and the name match (C-5.4, C-5.6)', () => {
  it('formats county code plus six digits', () => {
    expect(formatFarmerNumber('CE-JUB', 123)).toBe('CE-JUB-000123');
    expect(formatFarmerNumber('CE-JUB', 123)).toMatch(FARMER_NUMBER_PATTERN);
  });
  it('compares names trimmed, NFC-normalised and lower-cased, and nothing else', () => {
    expect(nameMatchKey('  ACHÔL ')).toBe(nameMatchKey('achôl'));
    expect(nameMatchKey('Achôl')).toBe(nameMatchKey('Achôl'));
    expect(nameMatchKey('Achol')).not.toBe(nameMatchKey('Achôl'));
  });
});
