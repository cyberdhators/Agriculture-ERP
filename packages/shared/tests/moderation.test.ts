import { describe, expect, it } from 'vitest';

import { STAFF_PERMISSION_MESSAGES, accountSanctionSchema } from '../src';

const ID = '7a1b2c3d-0000-4000-8000-000000000001';

describe('suspending or restoring an account', () => {
  it('names a farmer or buyer record and gives a reason', () => {
    expect(
      accountSanctionSchema.safeParse({ kind: 'farmer', id: ID, reason: 'Fake listings' }).success,
    ).toBe(true);
    expect(
      accountSanctionSchema.safeParse({ kind: 'buyer', id: ID, reason: 'Abusive messages' })
        .success,
    ).toBe(true);
  });

  it('refuses a reason too short to explain anything, in our own words', () => {
    const short = accountSanctionSchema.safeParse({ kind: 'farmer', id: ID, reason: ' no ' });
    expect(short.error?.issues[0]?.message).toBe(STAFF_PERMISSION_MESSAGES.reasonRequired);
  });

  it('cannot be aimed at a staff account', () => {
    for (const kind of ['officer', 'admin', 'user']) {
      expect(accountSanctionSchema.safeParse({ kind, id: ID, reason: 'Some reason' }).success).toBe(
        false,
      );
    }
  });
});
