import { describe, expect, it } from 'vitest';

import { HOME_PATH, isPortalPath, safeNext } from './paths';

describe('isPortalPath', () => {
  it('guards every portal prefix and its children', () => {
    for (const p of [
      '/dashboard',
      '/farmers',
      '/farmers/abc',
      '/admin/users',
      '/desk',
      '/visits',
      '/design',
    ]) {
      expect(isPortalPath(p)).toBe(true);
    }
  });

  it('leaves the farmer side, the market, the API and the login page open', () => {
    for (const p of [
      '/',
      '/farmer',
      '/farmer/login',
      '/market',
      '/market/1',
      '/api/me',
      '/login',
    ]) {
      expect(isPortalPath(p)).toBe(false);
    }
  });

  it('matches whole segments, not prefixes of longer ones', () => {
    expect(isPortalPath('/farmersXYZ')).toBe(false);
    expect(isPortalPath('/desktop')).toBe(false);
  });
});

describe('safeNext', () => {
  it('honours a same-origin path', () => {
    expect(safeNext('/farmers/review?q=a')).toBe('/farmers/review?q=a');
  });

  it('refuses absolute, protocol-relative and empty targets', () => {
    expect(safeNext('https://evil.example')).toBe(HOME_PATH);
    expect(safeNext('//evil.example')).toBe(HOME_PATH);
    expect(safeNext('')).toBe(HOME_PATH);
    expect(safeNext(null)).toBe(HOME_PATH);
    expect(safeNext(undefined)).toBe(HOME_PATH);
  });
});
