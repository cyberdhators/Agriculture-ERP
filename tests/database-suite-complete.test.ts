import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * THE STAGING SUITE'S COMPLETENESS GUARD (2026-09-20).
 *
 * The pure suite has had one since 2026-09-11; the database suite has not, and
 * the asymmetry is the point of this file.
 *
 * WHY B5.5'S ENVIRONMENT GUARD DOES NOT COVER THIS. It closed the eight silently
 * skipped files by making every database test refuse loudly when its
 * environment is missing. That guard lives INSIDE the file it protects, so it
 * can only ever speak for a file that is already running. **A file that never
 * enters the run cannot fail its own guard.** Delete one, rename it out of the
 * include globs, or empty it, and the suite reports green with one file fewer
 * and nothing says so -- the run's own total is printed and never asserted.
 * See docs/PROJECT-STATE.md, "a guard that lives inside the thing it guards".
 *
 * So this compares FROM OUTSIDE: the files on disk against the list below.
 * Both directions fail -- a file that exists and is not declared, and a name
 * declared that no longer exists. The second is what catches a deletion.
 *
 * THE SET, NOT THE COUNT. A count is brittle against legitimate additions and
 * brittle guards get relaxed; a set names what changed and reads as a decision.
 *
 * Pure: it reads files and compares two lists. No database, so it runs on the
 * documents short path too -- which is where a missing database test would
 * otherwise be least visible.
 *
 * THIS FILE CAUGHT ITSELF ON ITS FIRST RUN, as the pure guard did before it:
 * the marker names appeared in its own prose, so it read as a database test and
 * failed for being undeclared. The mentions are worded around rather than
 * concatenated, and the failure was the guard working.
 */
const root = fileURLToPath(new URL('..', import.meta.url));

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', 'dist'].includes(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.test.ts')) out.push(full.slice(root.length));
  }
  return out;
};

/**
 * A file belongs to the staging suite if it reaches the database. Assembled
 * from fragments for the same reason the pure guard does it: a literal would
 * appear in THIS file's source and this file would classify itself.
 */
const DATABASE_MARKERS = ['makeTest' + 'Prisma', 'require' + 'TestEnv', 'new Prisma' + 'Client'];
const touchesDatabase = (relative: string): boolean =>
  DATABASE_MARKERS.some((marker) => readFileSync(join(root, relative), 'utf8').includes(marker));

/**
 * EVERY TEST FILE THAT RUNS AGAINST STAGING. Adding one means adding a line
 * here, and that is deliberate: the list is what makes a REMOVED file visible.
 */
const DATABASE_SUITE = [
  'tests/audit-actions-constraint.test.ts',
  'tests/audit.test.ts',
  'tests/auth-unavailable.test.ts',
  'tests/backup.test.ts',
  'tests/communications.test.ts',
  'tests/directories-routes.test.ts',
  'tests/directories.test.ts',
  'tests/enums-match-constants.test.ts',
  'tests/farmers-seed.test.ts',
  'tests/farmers.test.ts',
  'tests/farms.test.ts',
  'tests/forbidden-matrix.test.ts',
  'tests/locations-reseed.test.ts',
  'tests/locations.test.ts',
  'tests/new-routes-matrix.test.ts',
  'tests/product-reports.test.ts',
  'tests/reassignment.test.ts',
  'tests/reporting.test.ts',
  'tests/scope-and-lifecycle.test.ts',
  'tests/sync.test.ts',
  'tests/verification.test.ts',
  'tests/views-track-tables.test.ts',
  'tests/visits.test.ts',
  'tests/weather.test.ts',
] as const;

/** The include patterns of vitest.config.mts, as globs this file can test. */
const ROOT_PATTERNS = [/^apps\/.*\.test\.ts$/, /^packages\/.*\.test\.ts$/, /^tests\/.*\.test\.ts$/];

describe('the staging suite runs every test that needs a database', () => {
  const all = walk(root).map((p) => p.replace(/\\/g, '/'));
  const onDisk = all.filter(touchesDatabase).sort();

  it('found the repository’s test files at all', () => {
    // The walk could silently find nothing, which would make every assertion
    // below vacuously true. That is the failure this guards against, and it is
    // the same reason the pure guard opens the same way.
    expect(all.length).toBeGreaterThan(20);
    expect(all).toContain('tests/reporting.test.ts');
  });

  it('every database test file on disk is declared', () => {
    const undeclared = onDisk.filter((f) => !(DATABASE_SUITE as readonly string[]).includes(f));
    expect(
      undeclared,
      'these test files reach the database and are not in DATABASE_SUITE. Add them, so that ' +
        'removing one later is visible: ' +
        undeclared.join(', '),
    ).toEqual([]);
  });

  it('every declared file still exists — this is the one that catches a deletion', () => {
    const vanished = DATABASE_SUITE.filter((f) => !onDisk.includes(f));
    expect(
      vanished,
      'these files are declared as part of the staging suite and are no longer on disk (or no ' +
        'longer reach the database). A suite that quietly loses a file reports green for ' +
        'everything it no longer checks. Delete the line deliberately, or restore the file: ' +
        vanished.join(', '),
    ).toEqual([]);
  });

  it('every declared file is matched by the root config’s include patterns', () => {
    // A file can exist, be declared, and still never run if it sits outside the
    // globs. Renaming a directory is enough to do it.
    const unreachable = DATABASE_SUITE.filter((f) => !ROOT_PATTERNS.some((p) => p.test(f)));
    expect(
      unreachable,
      `vitest.config.mts would not collect these: ${unreachable.join(', ')}`,
    ).toEqual([]);
  });

  it('every database test file refuses loudly when the environment is missing (B5.5)', () => {
    // The inside guard, asserted from outside: this says the guard is PRESENT,
    // which is a different claim from the guard firing.
    const unguarded = onDisk.filter(
      (f) => !readFileSync(join(root, f), 'utf8').includes('require' + 'TestEnv'),
    );
    expect(
      unguarded,
      `these reach the database without B5.5's environment guard, so they would skip rather ` +
        `than fail if the variables were absent: ${unguarded.join(', ')}`,
    ).toEqual([]);
  });
});
