import { defineConfig } from 'vitest/config';

/**
 * THE PURE SUITE — tests that need no database and take no lock.
 *
 * Why it exists (2026-09-11, the fifth CI edit). 98% of a CI run is the
 * database suite: on #54's green run the test step was 44m46s and every other
 * step together was 47s. A pull request that changes nothing but documents
 * needs none of it — except that two tests read `docs/api/CONVENTIONS.md`, and
 * one of them lived under the root config, whose global setup demands the
 * staging environment and takes the one-run-at-a-time advisory lock. A test
 * that reads a file and an object should not need a database or hold a lock.
 *
 * This config has NO globalSetup, so the files below run anywhere, including
 * on a machine with no `.env.local`. They also still run under the root
 * config's `pnpm test`, so the full suite is unchanged and nothing is
 * exempted from it.
 *
 * ABSENCE IS NOT SUCCESS (B5.5's rule). Two guards, because a suite that
 * silently runs nothing is the shape of the eight skipped files and the null
 * device rows:
 *   1. `passWithNoTests` is false, so an empty run is a failure, not a pass.
 *   2. `tests/pure-suite-complete.test.ts` scans the repository for every test
 *      file that touches no database and asserts each one is matched by the
 *      patterns below — so a pure test added later and forgotten here turns
 *      this suite red rather than being quietly left out of it.
 */
export default defineConfig({
  test: {
    include: [
      'tests/conventions-rules.test.ts',
      'tests/pure-suite-complete.test.ts',
      'apps/web/**/*.test.ts',
      'packages/shared/tests/**/*.test.ts',
    ],
    environment: 'node',
    passWithNoTests: false,
  },
});
