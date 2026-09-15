import { describe, expect, it } from 'vitest';

import { officerAuthIdentifier } from '@agri-erp/shared';

import { loginIdentifier } from './identifier';

describe('loginIdentifier', () => {
  it('passes an email through, trimmed', () => {
    expect(loginIdentifier('  admin@agrionesouthsudan.com ')).toBe('admin@agrionesouthsudan.com');
  });

  it('derives the officer identifier from a phone in any accepted form', () => {
    const expected = officerAuthIdentifier('+211920000001');
    for (const written of [
      '+211920000001',
      '211920000001',
      '0920000001',
      '+211 920 000 001',
      '0920-000-001',
    ]) {
      expect(loginIdentifier(written)).toBe(expected);
    }
  });

  it('passes junk through unchanged so the server refuses it', () => {
    expect(loginIdentifier('not a login')).toBe('not a login');
    expect(loginIdentifier('+254700000000')).toBe('+254700000000');
  });
});
