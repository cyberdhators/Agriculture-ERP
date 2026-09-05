import { PrismaClient } from '@prisma/client';
import { missingTestEnv } from './tests/helpers/db';

/**
 * B5.5 — one run at a time against staging, wherever it starts.
 *
 * Every database test file creates principals under one prefix and calls one
 * global sweep. Two runs at once — CI and a laptop, or two branches in CI —
 * delete each other's accounts mid-run (seen 2026-09-05). A workflow
 * concurrency group cannot see a laptop, so the lock lives in the database: a
 * session-level advisory lock, taken here and held until teardown. A run that
 * finds it held fails at once and names the holder. A killed run's session
 * ends and the lock goes with it.
 *
 * Session-level, so it needs a session: this is the one test connection on
 * the session pooler (DIRECT_URL). Everything else uses the transaction pooler.
 */
export const STAGING_TEST_LOCK = 'agri-erp.staging-tests';

let holder: PrismaClient | undefined;

export async function setup(): Promise<void> {
  const missing = missingTestEnv();
  if (missing.length > 0) {
    throw new Error(
      `Database tests refuse to run: ${missing.join(', ')} not set. ` +
        'Locally, fill in .env.local; in CI, the STAGING_* secrets map to these names. ' +
        'Skipping silently is not an option (B5.5).',
    );
  }
  const who = `agri-erp-tests:${process.env.GITHUB_RUN_ID ?? process.env.USER ?? 'local'}`;
  holder = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  await holder.$executeRawUnsafe(`SET application_name = '${who.replace(/'/g, '')}'`);
  const [row] = await holder.$queryRawUnsafe<{ locked: boolean }[]>(
    'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
    STAGING_TEST_LOCK,
  );
  if (!row?.locked) {
    // Name only. A backend's age through the pooler is the server process's,
    // not this run's, so "running for" would mislead (seen: 5 min for a run
    // 12 s old).
    const others = await holder
      .$queryRawUnsafe<{ who: string }[]>(
        `SELECT a.application_name AS who
         FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
         WHERE l.locktype = 'advisory' AND l.granted AND l.objid = (hashtext($1)::bigint & 4294967295)`,
        STAGING_TEST_LOCK,
      )
      .catch(() => [] as { who: string }[]);
    await holder.$disconnect();
    holder = undefined;
    const named = others.map((o) => o.who).join(', ') || 'another run';
    throw new Error(
      `Another test run holds staging: ${named}. Runs are one at a time by design (B5.5). ` +
        'Wait for it to finish; if it is a dead run, terminate its session.',
    );
  }
}

export async function teardown(): Promise<void> {
  if (!holder) return;
  await holder
    .$queryRawUnsafe('SELECT pg_advisory_unlock(hashtext($1))', STAGING_TEST_LOCK)
    .catch(() => undefined);
  await holder.$disconnect();
  holder = undefined;
}
