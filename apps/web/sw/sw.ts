/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import {
  NetworkFirst,
  NetworkOnly,
  Serwist,
  type PrecacheEntry,
  type SerwistGlobalConfig,
} from 'serwist';

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

/**
 * THE FIELD PAGES (PWA step 4). An extension officer must be able to open
 * these with no signal even if they never opened them on this phone: the
 * window asks for them to be kept (`agrione-keep-field-pages`) once an
 * officer is signed in. Each is one address whatever follows the `?` --
 * /farms/record?farmer=<id> is the same page for every farmer, so it is kept
 * once and opens for all of them. The pages are the app's shell, not data:
 * what an officer sees on them comes from the per-account store.
 */
const FIELD_PAGES = ['/desk', '/farmers/new', '/farms/record', '/visits'];
const FIELD_CACHE = 'agrione-field-pages';

const fieldPages = {
  matcher: ({ request, url, sameOrigin }: { request: Request; url: URL; sameOrigin: boolean }) =>
    sameOrigin && request.mode === 'navigate' && FIELD_PAGES.includes(url.pathname),
  handler: new NetworkFirst({
    cacheName: FIELD_CACHE,
    matchOptions: { ignoreSearch: true },
    networkTimeoutSeconds: 8,
  }),
};

async function keepFieldPages(): Promise<void> {
  const cache = await caches.open(FIELD_CACHE);
  await Promise.all(
    FIELD_PAGES.map(async (path) => {
      try {
        const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
        // A redirect (to sign-in) is not the page: keep nothing under its name.
        if (res.ok && !res.redirected) await cache.put(path, res);
      } catch {
        // No signal: the next request tries again.
      }
    }),
  );
}

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string } | null)?.type === 'agrione-keep-field-pages') {
    event.waitUntil(keepFieldPages());
  }
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // The never-cached rules come first: the first matching rule wins.
  runtimeCaching: [...neverCached, fieldPages, ...defaultCache],
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

/**
 * Android's Background Sync (PWA step 2): when signal returns, wake any open
 * AgriOne window and tell it to send its outbox. The sending itself stays in
 * the page, where the signed-in account and its outbox are known.
 */
self.addEventListener('sync', (event: Event) => {
  const e = event as Event & { tag?: string; waitUntil(p: Promise<unknown>): void };
  if (e.tag !== 'agrione-outbox') return;
  e.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => windows.forEach((w) => w.postMessage({ type: 'agrione-sync' }))),
  );
});
