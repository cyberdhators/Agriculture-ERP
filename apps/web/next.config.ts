import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // packages/shared ships TypeScript source, so Next must compile it.
  transpilePackages: ['@agri-erp/shared'],
};

export default withSentryConfig(nextConfig, {
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
