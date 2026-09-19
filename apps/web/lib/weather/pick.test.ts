import { describe, expect, it } from 'vitest';

import { countyOf, pickLocation } from './pick';

const rows = [
  { payam_id: 'CE-JUB-JUB', county_id: 'CE-JUB' },
  { payam_id: 'CE-JUB-MUN', county_id: 'CE-JUB' },
  { payam_id: 'WE-YAM-YAM', county_id: 'WE-YAM' },
];

describe('countyOf', () => {
  it('is the first two segments of a location code', () => {
    expect(countyOf('CE-JUB-MUN')).toBe('CE-JUB');
  });
});

describe('pickLocation', () => {
  it('prefers the farmer’s own payam', () => {
    expect(pickLocation(rows, 'CE-JUB-MUN')?.payam_id).toBe('CE-JUB-MUN');
  });
  it('reads a county-level row, whose payam is null, as the county (contract §9.1)', () => {
    const county = [{ payam_id: null, county_id: 'CE-JUB' }];
    expect(pickLocation(county, 'CE-JUB-MUN')).toEqual({ payam_id: null, county_id: 'CE-JUB' });
  });

  it('falls back to any row in the county — one row, never a comparison', () => {
    expect(pickLocation(rows, 'CE-JUB-REJ')?.payam_id).toBe('CE-JUB-JUB');
  });
  it('is null when neither exists, which the tile shows as “no location yet”', () => {
    expect(pickLocation(rows, 'EE-TOR-TOR')).toBeNull();
    expect(pickLocation([], 'CE-JUB-MUN')).toBeNull();
  });
});
