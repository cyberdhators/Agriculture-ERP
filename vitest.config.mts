import { defineConfig } from 'vitest/config';

import { loadEnvLocal } from './scripts/load-env.mjs';

// Loads .env.local so database-backed tests can run locally. In CI there is no
// .env.local, DATABASE_URL stays empty, and those tests skip themselves.
loadEnvLocal();

export default defineConfig({
  test: {
    // Both tests live in apps/web. The cross-package test resolves
    // @agri-erp/shared through the pnpm workspace link -- deliberately not
    // through a Vitest alias, so that a broken workspace fails the test.
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    environment: 'node',
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? '',
    },
  },
});
