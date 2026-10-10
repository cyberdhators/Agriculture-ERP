/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import { NetworkOnly, Serwist, type PrecacheEntry, type SerwistGlobalConfig } from 'serwist';

/**
 * THE SERVICE WORKER (2026-10-10, PWA step 1).
 *
 * What it does: keeps the app's own files (pages, scripts, styles, fonts,
 * images) on the phone so AgriOne opens with no signal, and shows an offline
 * page for a screen that was never opened before.
 *
 * What it must NEVER do: keep server data. Every /api/ request and every call
 * to the sign-in service goes to the network only. Personal data that has to
 * work offline is stored by the app itself, per account, in the on-phone
 * database (step 2) and wiped at sign-out -- an HTTP cache shared by every
 * account on the phone would show one person's listings, requests or caseload
 * to the next person who picks the phone up.
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const neverCached = [
  // Our own server data and actions.
  {
    matcher: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
      sameOrigin && url.pathname.startsWith('/api/'),
    handler: new NetworkOnly(),
  },
  // Supabase (sign-in, sessions, storage) and any other service.
  {
    matcher: ({ sameOrigin }: { sameOrigin: boolean }) => !sameOrigin,
    handler: new NetworkOnly(),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // The never-cached rules come first: the first matching rule wins.
  runtimeCaching: [...neverCached, ...defaultCache],
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher: ({ request }) => request.destination === 'document',
      },
    ],
  },
});

serwist.addEventListeners();
