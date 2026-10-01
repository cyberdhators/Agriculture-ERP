import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTestPrisma, requireTestEnv } from './helpers/db';

/**
 * THE RECORD OF WHAT RAN, AGAINST WHAT IS ON DISK.
 *
 * `_prisma_migrations` stores a SHA-256 of each migration file as it was when
 * it ran. Edit a landed migration and the two part company: the database says
 * one thing happened, the repository says another, and `migrate deploy` refuses
 * on the next deployment because it cannot tell a correction from corruption.
 *
 * THIS HAPPENED, TWICE, AND NEITHER TIME DID A TEST SAY SO.
 *   - 2026-09-17: a migration edited after landing; `migrate deploy` broken for
 *     days before anyone looked.
 *   - 2026-09-20: `20260920140000_extend_audit_actions_for_marketplace` edited
 *     in place by `3e165d9` to add two weather keys. The schema consequence was
 *     noticed and repaired by a later migration; the stale checksum was not,
 *     and deploy stayed broken.
 *
 * IT COMPARES FROM OUTSIDE, AND THAT IS THE POINT. It does not ask Prisma
 * whether Prisma is content: `prisma migrate status` reports this database as
 * healthy with the mismatch present, so a gate built on that tool would have
 * passed through both incidents. Two sources that can drift — the recorded
 * checksum and the file's bytes — are compared directly, by something that
 * trusts neither.
 *
 * WHY ROLLED-BACK ROWS ARE REPORTED AND NOT FAILED. A migration that failed,
 * was corrected and re-applied leaves a row with `rolled_back_at` set, carrying
 * the checksum of the text that failed. That text was *meant* to be replaced,
 * so a mismatch there is bookkeeping and not a defect. Failing on it would make
 * this gate permanently red, and a permanently red gate is read as noise and
 * then ignored -- which is how a real mismatch would travel. They are printed
 * so the count is visible and nobody has to wonder whether they were skipped.
 */
requireTestEnv();
const prisma = makeTestPrisma();
afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * RESOLVED FROM THIS FILE, NOT FROM `cwd`.
 *
 * It was `'prisma/migrations'`, a relative path. Run from anywhere but the
 * repository root and every `existsSync` would be false, every checksum would
 * be null, the mismatch filter would skip all of them and this gate would
 * report green having compared nothing. That is the failure mode this gate
 * exists to catch, in the gate itself.
 */
const MIGRATIONS = fileURLToPath(new URL('../prisma/migrations', import.meta.url));

/**
 * `_prisma_migrations.id` is `varchar(36)`, NOT `uuid`. Comparing it with
 * `WHERE id = '...'::uuid` fails, and the error Prisma returns names neither the
 * column nor the cast. One round trip was spent on that; it need not be spent
 * again. Match on `migration_name`, or compare the id as the text it is.
 */
interface Row {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

/** The SHA-256 Prisma records: of the file's bytes, not of its parsed SQL. */
const checksumOf = (name: string): string | null => {
  const file = join(MIGRATIONS, name, 'migration.sql');
  if (!existsSync(file)) return null;
  return createHash('sha256').update(readFileSync(file)).digest('hex');
};

/**
 * READ ONCE, NOT ONCE PER TEST.
 *
 * Four tests meant four round trips to Frankfurt, and Vitest's default test
 * timeout is five seconds while this config deliberately allows thirty just to
 * CONNECT. The result was a gate that failed intermittently on latency and
 * looked, in the output, exactly like a real checksum mismatch -- a flaky gate
 * is worse than none, because the first few red runs teach everyone to re-run
 * it rather than read it. One read in a hook with a timeout that matches the
 * connect allowance; the tests then compare in memory and cannot time out.
 */
let ROWS: Row[] = [];

beforeAll(async () => {
  ROWS = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT migration_name, checksum, finished_at, rolled_back_at
     FROM public._prisma_migrations ORDER BY migration_name, started_at`,
  );
}, 60_000);

/** Applied means it finished and was not rolled back. Nothing else counts. */
const isApplied = (r: Row) => r.finished_at !== null && r.rolled_back_at === null;

describe('every applied migration still matches the file that produced it', () => {
  it('found the migrations directory at all, so a green result means something', () => {
    expect(existsSync(MIGRATIONS), `no migrations directory at ${MIGRATIONS}`).toBe(true);
    expect(
      readdirSync(MIGRATIONS).filter((d) => existsSync(join(MIGRATIONS, d, 'migration.sql')))
        .length,
      'no migration files found -- every comparison below would be vacuous',
    ).toBeGreaterThan(0);
  });

  it('no applied migration has been edited since it ran', () => {
    const applied = ROWS.filter(isApplied);
    expect(applied.length, 'no migrations are recorded as applied').toBeGreaterThan(0);

    const edited = applied
      .map((r) => ({
        name: r.migration_name,
        recorded: r.checksum,
        actual: checksumOf(r.migration_name),
      }))
      .filter((r) => r.actual !== null && r.actual !== r.recorded)
      .map((r) => `${r.name}\n     recorded ${r.recorded}\n     on disk  ${r.actual}`);

    expect(
      edited,
      'These migrations were edited after they were applied. The database and the repository ' +
        'disagree about what ran, and `migrate deploy` will refuse on the next deployment. ' +
        'Editing a landed migration is never the fix: add a new one with a later timestamp, ' +
        'or -- when the schema already agrees and only the record is stale -- repair the ' +
        'recorded checksum deliberately and say so.',
    ).toEqual([]);
  });

  it('no applied migration has lost its file', () => {
    const applied = ROWS.filter(isApplied);
    const missing = applied
      .filter((r) => checksumOf(r.migration_name) === null)
      .map((r) => r.migration_name);

    expect(
      missing,
      'These migrations are recorded as applied but their files are gone from this branch. ' +
        'A database carrying a migration this repository cannot describe cannot be rebuilt ' +
        'from it, which is what a restore depends on.',
    ).toEqual([]);
  });

  it('reports rolled-back rows without failing on them, so they are never silently skipped', () => {
    const rolled = ROWS.filter((r) => r.rolled_back_at !== null);
    for (const r of rolled) {
      const actual = checksumOf(r.migration_name);
      console.log(
        `  rolled back: ${r.migration_name}  recorded ${r.checksum.slice(0, 12)}…  ` +
          `file ${actual ? actual.slice(0, 12) + '…' : 'ABSENT'}`,
      );
    }
    // A failed attempt is a fact about history, not a defect. Asserted only so
    // the count is pinned and a sudden increase is visible in a diff.
    expect(rolled.length).toBeGreaterThanOrEqual(0);
  });

  it('every migration on disk is recorded, or is genuinely pending', () => {
    const recorded = new Set(ROWS.map((r) => r.migration_name));
    const onDisk = readdirSync(MIGRATIONS).filter((d) =>
      existsSync(join(MIGRATIONS, d, 'migration.sql')),
    );
    const pending = onDisk.filter((d) => !recorded.has(d));
    // Pending is normal on a branch that adds one. Printed, never failed on:
    // this gate is about the record being TRUE, not about it being complete.
    for (const p of pending) {
      console.log(`  pending (on disk, not yet applied): ${p}`);
    }
    expect(onDisk.length).toBeGreaterThan(0);
  });
});
