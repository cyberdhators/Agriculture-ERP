import { defineConfig } from 'vitest/config';
import { loadEnvLocal } from './scripts/load-env.mjs';

loadEnvLocal();

/**
 * Every database URL a test sees carries connect_timeout=30, whatever the
 * operator's own file says. Prisma's default connect timeout is 5 seconds; the
 * Supabase poolers' handshake takes 1-9 seconds on a slow day, and the failure
 * reads "Can't reach database server" — indistinguishable from an outage.
 * This runs before any worker imports a client, so it covers the app's client,
 * every test's client and any pool a test builds from the env. A test must
 * never depend on someone having got the value right in .env.local.
 */
const withParam = (url: string, key: string, value: string): string => {
  if (new RegExp(`[?&]${key}=`).test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${value}`;
};
const withConnectTimeout = (url: string | undefined): string =>
  url ? withParam(url, 'connect_timeout', '30') : '';

/**
 * The app's client, in a test process, stands in for many serverless
 * instances at once. Production's `connection_limit=1` is right for one
 * lambda; here it means every concurrent route call in a test queues behind
 * one connection, and Prisma's 10-second pool wait turns the queue into 500s
 * (P2024 — found 2026-09-05, 47 times in one run). Ten connections and a
 * 60-second wait; the pooler multiplexes them.
 */
const forTestProcess = (url: string | undefined): string => {
  if (!url) return '';
  let out = withConnectTimeout(url).replace(/([?&])connection_limit=\d+/, '$1connection_limit=10');
  out = withParam(out, 'connection_limit', '10');
  out = withParam(out, 'pool_timeout', '60');
  return out;
};

export default defineConfig({
  test: {
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    env: {
      DATABASE_URL: forTestProcess(process.env.DATABASE_URL),
      DIRECT_URL: withConnectTimeout(process.env.DIRECT_URL),
    },
  },
});
