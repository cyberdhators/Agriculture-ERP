import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The pure suite's own guard (2026-09-11). `vitest.pure.config.mts` runs the
 * tests that need no database, so a documents-only pull request can be
 * verified without the 45-minute staging suite. This file is the reason that
 * short path can be trusted: it finds every test file in the repository that
 * touches no database and asserts the pure config claims it.
 *
 * Absence is not success (B5.5). Without this, a pure test added later would
 * simply not run on the short path, and nothing would say so — the shape of
 * the eight silently skipped files (docs/PROJECT-STATE.md).
 */
const root = fileURLToPath(new URL('..', import.meta.url));

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (
      entry === 'node_modules' ||
      entry === '.next' ||
      entry === 'dist' ||
      entry.startsWith('.')
    ) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.test.ts')) out.push(full.slice(root.length));
  }
  return out;
};

/**
 * A file is impure if it reaches the database, directly or through the helpers.
 *
 * The pattern is assembled from fragments rather than written as one literal,
 * because a literal would appear in THIS file's own source and this file would
 * read as impure — which it did on the first run, and the guard caught itself.
 */
const DATABASE_MARKERS = ['makeTest' + 'Prisma', 'require' + 'TestEnv', 'new Prisma' + 'Client'];
const touchesDatabase = (relative: string): boolean => {
  const source = readFileSync(join(root, relative), 'utf8');
  return DATABASE_MARKERS.some((marker) => source.includes(marker));
};

/** The include patterns of vitest.pure.config.mts, as globs this file can test. */
const PURE_PATTERNS = [
  /^tests\/conventions-rules\.test\.ts$/,
  /^tests\/database-suite-complete\.test\.ts$/,
  /^tests\/pure-suite-complete\.test\.ts$/,
  /^apps\/web\/.*\.test\.ts$/,
  /^packages\/shared\/tests\/.*\.test\.ts$/,
];
const claimedByPureConfig = (relative: string): boolean =>
  PURE_PATTERNS.some((pattern) => pattern.test(relative));

describe('the pure suite claims every test that needs no database', () => {
  const all = walk(root).map((p) => p.replace(/\\/g, '/'));

  it('found the repository’s test files at all', () => {
    // The walk itself could silently find nothing; that would make every
    // assertion below vacuously true, which is the failure this guards.
    expect(all.length).toBeGreaterThan(20);
    expect(all).toContain('tests/conventions-rules.test.ts');
    expect(all).toContain('packages/shared/tests/scrub.test.ts');
  });

  it('every pure test file is matched by the pure config’s include patterns', () => {
    const pureOnDisk = all.filter((f) => !touchesDatabase(f)).sort();
    const missing = pureOnDisk.filter((f) => !claimedByPureConfig(f));
    expect(
      missing,
      `these test files need no database but the pure config does not run them; add them to vitest.pure.config.mts and to PURE_PATTERNS here: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('every file the pure config claims needs no database', () => {
    const claimed = all.filter(claimedByPureConfig).sort();
    const impure = claimed.filter(touchesDatabase);
    expect(
      impure,
      `the pure config runs these, but they reach the database and will fail without staging: ${impure.join(', ')}`,
    ).toEqual([]);
    expect(claimed.length).toBeGreaterThan(5);
  });
});
