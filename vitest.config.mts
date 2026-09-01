import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Both tests live in apps/web. The cross-package test resolves
    // @agri-erp/shared through the pnpm workspace link -- deliberately not
    // through a Vitest alias, so that a broken workspace fails the test.
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    environment: 'node',
  },
});
