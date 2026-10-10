import { withSentryConfig } from '@sentry/nextjs';
import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';

/**
 * PWA (2026-10-10): the service worker is compiled from sw/sw.ts to
 * public/sw.js at build time and registered on every page. Off in
 * development, where a cached app would hide every change being made.
 */
const withSerwist = withSerwistInit({
  swSrc: 'sw/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
  cacheOnNavigation: true,
  reloadOnOnline: false,
  // Stored at install, so the installed app opens with no signal even on
  // its first offline start: the home router and the offline page. Both are
  // public pages (no sign-in redirect), so the install cannot fail on them.
  // The revision changes with every deployment, so a new build's copies
  // replace the old ones.
  additionalPrecacheEntries: ['/open', '/offline'].map((url) => ({
    url,
    revision: process.env.VERCEL_GIT_COMMIT_SHA ?? String(Date.now()),
  })),
});

const nextConfig: NextConfig = {
  // packages/shared ships TypeScript source, so Next must compile it.
  transpilePackages: ['@agri-erp/shared'],
};

export default withSentryConfig(withSerwist(nextConfig), {
  // No source maps are uploaded in B1.5. That needs a build-time auth token
  // and CI wiring, which this unit does not touch. The cost is that
  // client-side stack traces stay minified. Recorded in docs/PROJECT-STATE.md.
  sourcemaps: { disable: true },

  // Errors only: strip the tracing code out of the client bundle entirely,
  // rather than shipping it and sampling at zero.
  disableLogger: true,

  // Never print SDK setup chatter into the build log.
  silent: true,

  // Do not route Sentry's own requests through our domain. That rewrite exists
  // to dodge ad blockers; it would also mean browser error reports transit a
  // path we would then have to reason about.
  tunnelRoute: undefined,
});
