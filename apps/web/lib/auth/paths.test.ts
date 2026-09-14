import { describe, expect, it } from 'vitest';

import { frontDoor, HOME_PATH, isPortalPath, safeNext } from './paths';

describe('isPortalPath', () => {
  it('guards every portal prefix and its children, whatever the market flag says', () => {
    for (const p of [
      '/dashboard',
      '/farmers',
      '/farmers/abc',
      '/admin/users',
      '/desk',
      '/visits',
      '/reports',
      '/design',
    ]) {
      expect(isPortalPath(p, false)).toBe(true);
      expect(isPortalPath(p, true)).toBe(true);
    }
  });

  it('gates the marketplace and the farmer side only when the deployment closes them', () => {
    for (const p of ['/market', '/market/1', '/farmer', '/farmer/login', '/farmer/account']) {
      expect(isPortalPath(p, false)).toBe(true);
    }
  });

  it('leaves the marketplace and the farmer side open by default', () => {
    for (const p of ['/market', '/market/1', '/farmer', '/farmer/login']) {
      expect(isPortalPath(p, true)).toBe(false);
    }
  });

  it('leaves the root, the API and the login page open in both states', () => {
    for (const p of ['/', '/api/me', '/login']) {
      expect(isPortalPath(p, false)).toBe(false);
      expect(isPortalPath(p, true)).toBe(false);
    }
  });

  it('matches whole segments, not prefixes of longer ones', () => {
    expect(isPortalPath('/farmersXYZ', false)).toBe(false);
    expect(isPortalPath('/desktop', false)).toBe(false);
    expect(isPortalPath('/marketing', false)).toBe(false);
  });
});

describe('frontDoor', () => {
  it('is the marketplace when open and sign-in when gated', () => {
    expect(frontDoor(true)).toBe('/market');
    expect(frontDoor(false)).toBe('/login');
  });
});

describe('safeNext', () => {
  it('honours a same-origin path', () => {
    expect(safeNext('/farmers/review?q=a')).toBe('/farmers/review?q=a');
  });

  it('refuses absolute, protocol-relative, backslash and empty targets', () => {
    expect(safeNext('https://evil.example')).toBe(HOME_PATH);
    expect(safeNext('//evil.example')).toBe(HOME_PATH);
    // Some browsers normalise a backslash to a slash, so these can become
    // protocol-relative after passing a `//` check.
    expect(safeNext('/\\evil.example')).toBe(HOME_PATH);
    expect(safeNext('/\\/evil.example')).toBe(HOME_PATH);
    expect(safeNext('')).toBe(HOME_PATH);
    expect(safeNext(null)).toBe(HOME_PATH);
    expect(safeNext(undefined)).toBe(HOME_PATH);
  });
});
