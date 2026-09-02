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
    // tests/ holds tests that exercise the DATABASE rather than a package:
    // migrations, constraints, views and the location scripts. They belong to
    // no workspace package, so they live at the root.
    //
    // They skip themselves when DATABASE_URL is empty, which is the case in CI.
    // That is a real coverage gap and it is recorded in docs/PROJECT-STATE.md.
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      // Database tests use the SESSION pooler, not the transaction pooler:
      // they run interactive transactions and DDL. See makePrisma in
      // scripts/locations-lib.mjs.
      DIRECT_URL: process.env.DIRECT_URL ?? '',
    },
  },
});
