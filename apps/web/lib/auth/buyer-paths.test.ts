import { describe, expect, it } from 'vitest';

import {
  BUYER_HOME_PATH,
  HOME_PATH,
  LOGIN_PATH,
  STAFF_LOGIN_PATH,
  homeFor,
  isBuyerPath,
  isPortalPath,
  loginPathFor,
  safeNext,
} from './paths';

/** B13: which buyer pages need a session, and where sign-in sends each role. */
describe('the buyer side of the gate', () => {
  it('every buyer page needs a session except the application form', () => {
    expect(isPortalPath('/buyer/dashboard', true)).toBe(true);
    expect(isPortalPath('/buyer/orders/123', true)).toBe(true);
    expect(isPortalPath('/buyer', true)).toBe(true);
    expect(isPortalPath('/buyer/register', true)).toBe(false);
  });

  it('does not mistake a lookalike prefix for the buyer side', () => {
    expect(isBuyerPath('/buyers')).toBe(false);
    expect(isBuyerPath('/buyer-help')).toBe(false);
  });

  it('a buyer lands on the buyer dashboard, whatever staff page next named', () => {
    expect(homeFor('buyer', HOME_PATH)).toBe(BUYER_HOME_PATH);
    expect(homeFor('buyer', '/admin/users')).toBe(BUYER_HOME_PATH);
    expect(homeFor('buyer', '/buyer/orders')).toBe('/buyer/orders');
  });

  it('staff are never sent into the buyer side', () => {
    expect(homeFor('admin', '/buyer/dashboard')).toBe(HOME_PATH);
    expect(homeFor('officer', '/farmers')).toBe('/farmers');
  });

  it('an off-site next is still refused before any of this', () => {
    expect(homeFor('buyer', safeNext('//evil.example'))).toBe(BUYER_HOME_PATH);
  });
});

describe('the staff sign-in at /admin/login (2026-10-09)', () => {
  it('is not itself gated, though it sits under /admin', () => {
    expect(isPortalPath(STAFF_LOGIN_PATH, true)).toBe(false);
    expect(isPortalPath('/admin/users', true)).toBe(true);
  });

  it('staff pages send a signed-out visitor to the staff sign-in', () => {
    expect(loginPathFor('/dashboard')).toBe(STAFF_LOGIN_PATH);
    expect(loginPathFor('/admin/users')).toBe(STAFF_LOGIN_PATH);
    expect(loginPathFor('/farmers/abc')).toBe(STAFF_LOGIN_PATH);
  });

  it('buyer pages send a signed-out visitor to the buyer sign-in', () => {
    expect(loginPathFor('/buyer/dashboard')).toBe(LOGIN_PATH);
    expect(loginPathFor('/buyer/cart')).toBe(LOGIN_PATH);
  });
});
