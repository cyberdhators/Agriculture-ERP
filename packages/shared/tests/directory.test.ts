import { describe, expect, it } from 'vitest';

import {
  DIRECTORY_LIMITS,
  DIRECTORY_MESSAGES,
  PHONE_MESSAGES,
  directoryEntryInputSchema,
} from '../src/index';

/**
 * Directory entry validation. Unit P1, C-13.1 to C-13.5.
 *
 * Every rule is tested in both directions: the input it refuses and the
 * neighbouring input it accepts. A guard that refuses everything passes every
 * refusal test perfectly (the B1.3 lesson).
 */

const TODAY = '2026-09-04';
const schema = directoryEntryInputSchema(TODAY);

const dealer = {
  entry_type: 'agro_dealer',
  name: 'Juba Seed Store',
  services: ['seeds', 'fertiliser'],
  phone: '0912 345 678',
  payam_id: 'CE-JUB-JUB',
  state_id: 'CE',
  last_verified_at: '2026-09-01',
};

const bank = {
  ...dealer,
  entry_type: 'financial_service',
  name: 'Equity Bank, Juba',
  provider_class: 'bank',
};

const firstMessage = (input: unknown, field: string): string | undefined => {
  const result = schema.safeParse(input);
  if (result.success) return undefined;
  return result.error.issues.find((i) => i.path.join('.') === field)?.message;
};

describe('a minimal entry', () => {
  it('accepts an agro-dealer with the required fields only', () => {
    const result = schema.safeParse(dealer);
    expect(result.success).toBe(true);
  });

  it('normalises the phone to E.164 and never stores it any other way', () => {
    const result = schema.parse(dealer);
    expect(result.phone).toBe('+211912345678');
  });

  it('defaults active to true and services to an empty list', () => {
    const { services: _services, ...noServices } = dealer;
    const result = schema.parse(noServices);
    expect(result.active).toBe(true);
    expect(result.services).toEqual([]);
  });

  it('refuses a key it does not know, so a typo cannot silently vanish', () => {
    expect(schema.safeParse({ ...dealer, balance: 100 }).success).toBe(false);
  });
});

describe('entry type', () => {
  it('accepts each of the three', () => {
    for (const entry_type of ['agro_dealer', 'input_supplier']) {
      expect(schema.safeParse({ ...dealer, entry_type }).success).toBe(true);
    }
    expect(schema.safeParse(bank).success).toBe(true);
  });

  it('refuses anything else, with the sentence naming the three', () => {
    expect(firstMessage({ ...dealer, entry_type: 'warehouse' }, 'entry_type')).toBe(
      DIRECTORY_MESSAGES.typeUnknown,
    );
  });
});

describe('name', () => {
  it('trims and keeps a name exactly, including non-Latin characters', () => {
    expect(schema.parse({ ...dealer, name: '  متجر البذور  ' }).name).toBe('متجر البذور');
  });

  it('refuses a blank name and a missing one with different sentences', () => {
    expect(firstMessage({ ...dealer, name: '   ' }, 'name')).toBe(DIRECTORY_MESSAGES.nameBlank);
    const { name: _name, ...missing } = dealer;
    expect(firstMessage(missing, 'name')).toBe(DIRECTORY_MESSAGES.nameRequired);
  });

  it('refuses a name one character over the limit and accepts one at it', () => {
    const atLimit = 'x'.repeat(DIRECTORY_LIMITS.nameMax);
    expect(schema.safeParse({ ...dealer, name: atLimit }).success).toBe(true);
    expect(firstMessage({ ...dealer, name: `${atLimit}x` }, 'name')).toBe(
      DIRECTORY_MESSAGES.nameTooLong,
    );
  });
});

describe('services', () => {
  it('trims each service', () => {
    expect(schema.parse({ ...dealer, services: [' seeds '] }).services).toEqual(['seeds']);
  });

  it('refuses an empty service and a duplicate, case-insensitively', () => {
    expect(firstMessage({ ...dealer, services: ['seeds', ' '] }, 'services.1')).toBe(
      DIRECTORY_MESSAGES.serviceBlank,
    );
    expect(firstMessage({ ...dealer, services: ['Seeds', 'seeds'] }, 'services')).toBe(
      DIRECTORY_MESSAGES.servicesDuplicate,
    );
  });

  it('refuses one more than the maximum and accepts the maximum', () => {
    const max = Array.from({ length: DIRECTORY_LIMITS.servicesMax }, (_, i) => `s${i}`);
    expect(schema.safeParse({ ...dealer, services: max }).success).toBe(true);
    expect(firstMessage({ ...dealer, services: [...max, 'one more'] }, 'services')).toBe(
      DIRECTORY_MESSAGES.servicesTooMany,
    );
  });
});

describe('phones', () => {
  it('uses the shared phone rules, so the directory cannot accept a number a farmer record refuses', () => {
    expect(firstMessage({ ...dealer, phone: '+254712345678' }, 'phone')).toBe(
      PHONE_MESSAGES.wrongCountry,
    );
  });

  it('accepts an absent, null, or valid alternative phone, and refuses an invalid one', () => {
    expect(schema.safeParse(dealer).success).toBe(true);
    expect(schema.safeParse({ ...dealer, alt_phone: null }).success).toBe(true);
    expect(schema.parse({ ...dealer, alt_phone: '+211 92 000 0000' }).alt_phone).toBe(
      '+211920000000',
    );
    expect(firstMessage({ ...dealer, alt_phone: '12' }, 'alt_phone')).toBe(PHONE_MESSAGES.tooFew);
  });
});

describe('email and address', () => {
  it('turns an empty email into null and accepts a valid one', () => {
    expect(schema.parse({ ...dealer, email: '' }).email).toBeNull();
    expect(schema.parse({ ...dealer, email: 'shop@example.org' }).email).toBe('shop@example.org');
  });

  it('refuses an email without a domain', () => {
    expect(firstMessage({ ...dealer, email: 'shop@' }, 'email')).toBe(
      DIRECTORY_MESSAGES.emailInvalid,
    );
  });

  it('turns an empty address into null', () => {
    expect(schema.parse({ ...dealer, physical_address: '  ' }).physical_address).toBeNull();
  });
});

describe('location', () => {
  it('accepts a point in South Sudan and null', () => {
    const point = { latitude: 4.85, longitude: 31.6 };
    expect(schema.parse({ ...dealer, location: point }).location).toEqual(point);
    expect(schema.parse({ ...dealer, location: null }).location).toBeNull();
  });

  it('refuses a latitude beyond 90 and a longitude beyond 180', () => {
    expect(
      firstMessage({ ...dealer, location: { latitude: 91, longitude: 0 } }, 'location.latitude'),
    ).toBe(DIRECTORY_MESSAGES.latitudeRange);
    expect(
      firstMessage({ ...dealer, location: { latitude: 0, longitude: -181 } }, 'location.longitude'),
    ).toBe(DIRECTORY_MESSAGES.longitudeRange);
  });

  it('refuses a point with the coordinates swapped into unknown keys', () => {
    expect(schema.safeParse({ ...dealer, location: { lat: 4.85, lng: 31.6 } }).success).toBe(
      false,
    );
  });
});

describe('provider class, both directions', () => {
  it('requires a class on a financial service', () => {
    const { provider_class: _pc, ...noClass } = bank;
    expect(firstMessage(noClass, 'provider_class')).toBe(DIRECTORY_MESSAGES.providerClassRequired);
    expect(firstMessage({ ...bank, provider_class: null }, 'provider_class')).toBe(
      DIRECTORY_MESSAGES.providerClassRequired,
    );
  });

  it('forbids a class on a dealer or supplier', () => {
    expect(firstMessage({ ...dealer, provider_class: 'bank' }, 'provider_class')).toBe(
      DIRECTORY_MESSAGES.providerClassNotAllowed,
    );
  });

  it('refuses a class it does not know', () => {
    expect(firstMessage({ ...bank, provider_class: 'lender' }, 'provider_class')).toBe(
      DIRECTORY_MESSAGES.providerClassUnknown,
    );
  });
});

describe('last verified date', () => {
  it('accepts today and yesterday', () => {
    expect(schema.safeParse({ ...dealer, last_verified_at: TODAY }).success).toBe(true);
    expect(schema.safeParse({ ...dealer, last_verified_at: '2026-09-03' }).success).toBe(true);
  });

  it('refuses tomorrow', () => {
    expect(firstMessage({ ...dealer, last_verified_at: '2026-09-05' }, 'last_verified_at')).toBe(
      DIRECTORY_MESSAGES.verifiedDateFuture,
    );
  });

  it('refuses a date that does not exist and a date in another format', () => {
    expect(firstMessage({ ...dealer, last_verified_at: '2026-02-30' }, 'last_verified_at')).toBe(
      DIRECTORY_MESSAGES.verifiedDateFormat,
    );
    expect(firstMessage({ ...dealer, last_verified_at: '04/09/2026' }, 'last_verified_at')).toBe(
      DIRECTORY_MESSAGES.verifiedDateFormat,
    );
  });

  it('is required', () => {
    const { last_verified_at: _d, ...missing } = dealer;
    expect(firstMessage(missing, 'last_verified_at')).toBe(
      DIRECTORY_MESSAGES.verifiedDateRequired,
    );
  });
});

describe('location codes', () => {
  it('refuses a payam code in the wrong shape, using the location rules', () => {
    expect(schema.safeParse({ ...dealer, payam_id: 'juba' }).success).toBe(false);
  });
});
