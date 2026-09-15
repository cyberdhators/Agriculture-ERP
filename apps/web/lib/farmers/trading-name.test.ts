import { describe, expect, it } from 'vitest';

import { tradingNameError } from './trading-name';

const mary = { given_name: 'Mary', family_name: 'Aluel' };

describe('tradingNameError', () => {
  it('accepts a farm or stall name', () => {
    expect(tradingNameError('Rejaf Sorghum Store', mary)).toBeUndefined();
  });
  it('refuses empty and over-long names', () => {
    expect(tradingNameError(' ', mary)).toBe('error.tradingName');
    expect(tradingNameError('x'.repeat(61), mary)).toBe('error.tradingNameLong');
  });
  it('refuses the farmer’s own name, in any case, anywhere in the string', () => {
    expect(tradingNameError('Mary Aluel Farm', mary)).toBe('error.tradingNameIsYourName');
    expect(tradingNameError('ALUEL produce', mary)).toBe('error.tradingNameIsYourName');
    expect(tradingNameError("mary's garden", mary)).toBe('error.tradingNameIsYourName');
  });
  it('does not refuse a two-letter name part by accident', () => {
    expect(
      tradingNameError('Ali Stall', { given_name: 'Al', family_name: 'Deng' }),
    ).toBeUndefined();
  });
});
