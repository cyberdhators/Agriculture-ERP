'use client';

import { rememberHome } from './home';

/**
 * ASK THE SERVICE WORKER TO STORE AN ACCOUNT'S PAGES (2026-10-10), so the
 * installed app opens them with no signal even if they were never visited on
 * this phone. Pages are the app's shell, never data. Once per browser session
 * per list: the service worker refreshes each page on every later visit.
 */

export const FARMER_PAGES = [
  '/open',
  '/offline',
  '/farmer/account',
  '/farmer/account/listings',
  '/farmer/account/listings/new',
  '/farmer/account/notifications',
  '/farmer/account/farm',
  '/farmer/account/prices',
  '/farmer/account/weather',
  '/farmer/account/learn',
  '/farmer/account/services',
  '/farmer/account/settings',
  '/farmer/account/language',
  '/farmer/account/verification',
] as const;

export const OFFICER_PAGES = [
  '/open',
  '/offline',
  '/desk',
  '/farmers/new',
  '/farms/record',
  '/visits',
] as const;

export function keepPagesOffline(home: string, paths: readonly string[]): void {
  if (typeof window === 'undefined') return;
  rememberHome(home);
  if (!navigator.onLine || !('serviceWorker' in navigator)) return;
  const key = `agrione.pwa.kept:${home}`;
  try {
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, '1');
  } catch {
    // Storage blocked: ask anyway; storing twice is harmless.
  }
  void navigator.serviceWorker.ready
    .then((reg) => reg.active?.postMessage({ type: 'agrione-keep-pages', paths: [...paths] }))
    .catch(() => undefined);
}
