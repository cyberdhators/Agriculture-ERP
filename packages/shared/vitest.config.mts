import { defineConfig } from 'vitest/config';

/**
 * The shared package's tests are pure: schemas, the scrubber, the drift test.
 * Run from this directory they must not inherit the root config, whose global
 * setup requires the staging environment and takes the one-run-at-a-time
 * lock (B5.5). Found 2026-09-05: the root config's global setup, resolved
 * relative to this directory, did not exist, and the package's own test
 * command failed to load.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
