/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import {
  ExpirationPlugin,
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
 * THE APP'S PAGES, KEPT FOR OFFLINE (2026-10-10, fixed after "the offline
 * feature is not working": the installed app would not open a page offline).
 *
 * Found by damage, in the live sw.js: no page was stored ahead of time --
 * not even /offline, so the fallback had nothing to show -- and the default
 * rule for pages never matched a real page visit (it tests the REQUEST's
 * Content-Type, which a navigation does not send), so visited pages fell into
 * the catch-all "others" store: 24 hours, 32 entries shared with everything.
 *
 * Now every page visit (never /api/) is network-first into its own store,
 * kept 30 days, with a short wait before falling back so a weak signal does
 * not leave the screen blank. A page's address is one page whatever follows
 * the `?` (/farms/record?farmer=<id> is the same page for every farmer). A
 * redirect -- to a sign-in page -- is never stored under the address that
 * redirected. And the window asks for its account's pages to be stored as
 * soon as someone signs in (`agrione-keep-pages`), so they open offline even
 * if they were never visited on this phone. The pages are the app's shell, not
 * data: what anyone sees on them comes from the per-account store.
 */
const PAGES_CACHE = 'agrione-pages';
const PAGE_MAX_AGE_S = 30 * 24 * 60 * 60;

const onlyRealPages = {
  cacheWillUpdate: async ({ response }: { response: Response }) =>
    response.status === 200 && !response.redirected ? response : null,
};

const pages = {
  matcher: ({ request, url, sameOrigin }: { request: Request; url: URL; sameOrigin: boolean }) =>
    sameOrigin && request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
  handler: new NetworkFirst({
    cacheName: PAGES_CACHE,
    matchOptions: { ignoreSearch: true },
    networkTimeoutSeconds: 6,
    plugins: [
      onlyRealPages,
      new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: PAGE_MAX_AGE_S }),
    ],
  }),
};

/** The officer's field pages, for a window that still sends the old message. */
const FIELD_PAGES = ['/open', '/desk', '/farmers/new', '/farms/record', '/visits'];

/** Our own page addresses only: a path, never another site, never /api/. */
const isPagePath = (p: unknown): p is string =>
  typeof p === 'string' &&
  p.length < 200 &&
  p.startsWith('/') &&
  !p.startsWith('//') &&
  !p.startsWith('/api/');

async function keepPages(paths: readonly string[]): Promise<void> {
  const cache = await caches.open(PAGES_CACHE);
  await Promise.all(
    paths
      .filter(isPagePath)
      .slice(0, 40)
      .map(async (path) => {
        try {
          const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
          const kept = await onlyRealPages.cacheWillUpdate({ response: res });
          if (kept) await cache.put(path, kept);
        } catch {
          // No signal: the next sign-in or visit tries again.
        }
      }),
  );
}

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string; paths?: unknown } | null;
  if (data?.type === 'agrione-keep-pages' && Array.isArray(data.paths)) {
    event.waitUntil(keepPages(data.paths));
  } else if (data?.type === 'agrione-keep-field-pages') {
    event.waitUntil(keepPages(FIELD_PAGES));
  }
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // The never-cached rules come first: the first matching rule wins.
  runtimeCaching: [...neverCached, pages, ...defaultCache],
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

/**
 * PHONE ALERTS (2026-11-03). lib/push builds the wording on the server, fixed
 * sentences only. A later alert with the same tag replaces the earlier one, so
 * a busy conversation is one alert. While the person is looking at the app its
 * own live pop says it, so no alert is shown -- except on an iPhone, where
 * Safari is documented to withdraw alerts from a site that receives pushes
 * without showing them.
 */
const IOS = /iPhone|iPad|iPod/.test(self.navigator.userAgent);

self.addEventListener('push', (event: PushEvent) => {
  let alert: { title?: string; body?: string; href?: string; tag?: string; lang?: string };
  try {
    alert = (event.data?.json() ?? {}) as typeof alert;
  } catch {
    return;
  }
  if (!alert.title) return;
  const { title, body, href, tag, lang } = alert;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      if (!IOS && windows.some((w) => w.focused && w.visibilityState === 'visible')) return;
      return self.registration.showNotification(title, {
        body,
        tag,
        lang,
        dir: 'auto',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        data: { href: isPagePath(href) ? href : '/open' },
      });
    }),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const data = event.notification.data as { href?: unknown } | null;
  const href = isPagePath(data?.href) ? data.href : '/open';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const open = windows[0];
      if (!open) return self.clients.openWindow(href);
      await open.focus();
      return open.navigate(href);
    }),
  );
});

/** The push service replaced this phone's address: tell the server the new one. */
self.addEventListener('pushsubscriptionchange', (event: Event) => {
  const e = event as ExtendableEvent & {
    oldSubscription?: PushSubscription | null;
    newSubscription?: PushSubscription | null;
  };
  e.waitUntil(
    (async () => {
      const options = e.oldSubscription?.options;
      const next =
        e.newSubscription ??
        (options ? await self.registration.pushManager.subscribe(options) : null);
      if (!next) return;
      const { endpoint, keys } = next.toJSON();
      const language = self.navigator.language.startsWith('ar') ? 'ar' : 'en';
      await fetch('/api/account/push-subscription', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, keys, language }),
      });
    })().catch(() => undefined),
  );
});
