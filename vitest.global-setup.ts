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

  await refuseHandMadeStagingRows(holder);
}

/**
 * STAGING ROWS ARE THE SUITE'S OR THE SEED'S, NEVER HAND-MADE (CLAUDE.md §4).
 *
 * The rule was written in docs/HANDOFF.md on 2026-09-14 and broken at 07:48 the
 * next morning: an officer and a farmer made by hand in staging, neither
 * `zztest`, so the sweep left them; tests/reporting.test.ts counted state CE
 * by hand from its fixture, found one farmer too many, and main went red twice
 * for a reason that named no row. Same mechanism as #75 a day earlier.
 *
 * A law in a file governs only the sessions that open the file. This is the
 * resource refusing instead: it runs once per run, here, before any test, and
 * fails NAMING THE ROW rather than letting a counting test fail on it
 * obliquely an hour later.
 *
 * What is legitimate in staging, and how each is recognised:
 *   - a test farmer: family name `Zztestfamily` (tests/helpers/principals.ts);
 *   - a seed farmer: family name `Placeholder` AND an id in the seed's fixed
 *     block (scripts/farmers-seed-lib.mjs) — both, because a hand-made row can
 *     copy the name, and did ("Placeholder-Deng");
 *   - staff `user` rows: not checked — the staging logins are hand-made on
 *     purpose and the sweep skips them (#75);
 *   - officers: not checked directly, because the seed REQUIRES a non-zztest
 *     officer to exist and refuses without one. What breaks counts is farmers,
 *     so a hand-made officer is caught the moment a hand-made farmer points at
 *     it, and is otherwise inert.
 *
 * The check is a comparison — every farmer against two recognisers — not an
 * assertion, so it cannot be quietly wrong when a new legitimate kind appears:
 * a new kind fails here, and gets added here, deliberately.
 */
async function refuseHandMadeStagingRows(db: PrismaClient): Promise<void> {
  const rows = await db.$queryRawUnsafe<
    { id: string; family_name: string; payam_id: string; created_at: Date; by: string | null }[]
  >(
    `SELECT f.id, f.family_name, f.payam_id, f.created_at, o.name AS by
       FROM public.farmer f
       LEFT JOIN public.officer o ON o.id = f.registered_by
      WHERE f.deleted_at IS NULL
        AND f.family_name <> 'Zztestfamily'
        AND NOT (f.family_name = 'Placeholder' AND f.id::text LIKE '00000000-0000-4000-8000-0000050%')
      ORDER BY f.created_at`,
  );
  if (rows.length === 0) return;
  const lines = rows.map(
    (r) =>
      `  farmer ${r.id}  family "${r.family_name}"  payam ${r.payam_id}  created ${r.created_at.toISOString()}  registered by "${r.by ?? '(none)'}"`,
  );
  await db
    .$queryRawUnsafe('SELECT pg_advisory_unlock(hashtext($1))', STAGING_TEST_LOCK)
    .catch(() => undefined);
  await db.$disconnect();
  holder = undefined;
  throw new Error(
    `Staging holds ${rows.length} farmer row(s) that are neither the suite's nor the seed's:\n` +
      `${lines.join('\n')}\n` +
      "Staging rows are the test suite's or the seed's, never hand-made (CLAUDE.md §4). A " +
      'hand-made farmer makes every count in tests/reporting.test.ts off by one for a reason ' +
      'that names no row, which is why this refuses first and names it. Remove the row (the ' +
      'owner decides who; the auto-mode guard refuses a session a DELETE on the shared ' +
      'database), or use `pnpm farmers:seed` for demo data. Nothing ran.',
  );
}

export async function teardown(): Promise<void> {
  if (!holder) return;
  await holder
    .$queryRawUnsafe('SELECT pg_advisory_unlock(hashtext($1))', STAGING_TEST_LOCK)
    .catch(() => undefined);
  await holder.$disconnect();
  holder = undefined;
}
