import { describe, expect, it } from 'vitest';

import { accountSideFor } from './account-role';

describe('one account, buying and selling (2026-10-19)', () => {
  it('a buyer route meets the account as its buyer, a farmer route as its farmer', () => {
    const both = { buyer: true, farmer: true };
    expect(accountSideFor(['buyer'], both)).toBe('buyer');
    expect(accountSideFor(['farmer'], both)).toBe('farmer');
  });

  it('a route that admits both takes the first of its own roles the account holds', () => {
    expect(accountSideFor(['farmer', 'buyer'], { buyer: true, farmer: true })).toBe('farmer');
    expect(accountSideFor(['buyer', 'farmer'], { buyer: true, farmer: true })).toBe('buyer');
    expect(accountSideFor(['buyer', 'farmer'], { buyer: false, farmer: true })).toBe('farmer');
  });

  it('single-sided accounts behave as before: refused where they have no side', () => {
    expect(accountSideFor(['buyer'], { buyer: false, farmer: true })).toBeNull();
    expect(accountSideFor(['farmer'], { buyer: true, farmer: false })).toBeNull();
    expect(accountSideFor(['admin', 'officer'], { buyer: true, farmer: true })).toBeNull();
  });
});
