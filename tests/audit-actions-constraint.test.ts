import { afterAll, describe, expect, it, vi } from 'vitest';

import { AUDIT_ACTIONS } from '../packages/shared/src/audit';
import { makeTestPrisma, requireTestEnv } from './helpers/db';

/**
 * THE ELEVENTH SILENT-CLASS INSTANCE, CLOSED (docs/PROJECT-STATE.md).
 *
 * `AUDIT_ACTIONS` carried a comment saying the `audit_event_action_known`
 * CHECK "is generated from it, so the database refuses any key not here".
 * Nothing generated it. The generation was a person retyping the list into a
 * migration, and the review it relied on was a person noticing. Both worked
 * four times and then nearly did not: #28's migration, written in September
 * with twenty-two keys and never applied, would have replaced a forty-key
 * constraint and silently refused every farmer, consent, farm, visit,
 * attachment and report action -- failing every write in B5 to B11 on its
 * audit insert.
 *
 * This is the gate that compares (docs/PROJECT-STATE.md, "How to tell a gate
 * that can fail from one that cannot"). Two sources that move independently:
 * the constant in this repository, and the constraint in the live database.
 *
 * IT IS DELIBERATELY NOT SYMMETRIC, AND THE FIRST VERSION OF IT WAS.
 *
 * The direction that must be strict: a key in AUDIT_ACTIONS that the database
 * refuses. Every write recording it fails on its audit insert and the whole
 * transaction rolls back, so this is a defect in every case.
 *
 * The direction that must only REPORT: a key the database allows that the
 * constant does not have. Staging's schema runs ahead of main by design --
 * migrations are applied from a unit's branch before it merges (PROJECT-STATE,
 * "Staging's schema runs ahead of main"), so during that window the live CHECK
 * legitimately holds keys main's code has never heard of. The standing rule is
 * explicit: A TEST THAT READS THE SCHEMA TOLERATES OBJECTS IT DOES NOT KNOW.
 *
 * The first version of this test asserted set equality and would have gone red
 * on main for the whole of that window -- seam 1 of the seams list, fired by
 * the gate written to close the eleventh instance. Caught by working out what
 * its own pull request's run would do, before that run finished. The constant
 * and the migrations are compared exactly, with no window, by
 * packages/shared/tests/audit-check-matches-migrations.test.ts, which reads
 * files and needs no database.
 */
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
requireTestEnv();
const prisma = makeTestPrisma();
afterAll(async () => prisma.$disconnect());

const CONSTRAINT = 'audit_event_action_known';

async function constraintDefinition(): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<{ def: string }[]>(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = 'audit_event' AND c.conname = $1`,
    CONSTRAINT,
  );
  return rows[0]?.def ?? null;
}

/** The quoted keys inside the CHECK, in the order Postgres prints them. */
const keysIn = (definition: string): string[] =>
  [...definition.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]!);

describe('the audit action CHECK and AUDIT_ACTIONS are the same set', () => {
  it('the constraint exists at all', async () => {
    const def = await constraintDefinition();
    // A dropped constraint would let any string through, and every other
    // assertion here would pass vacuously against an empty key list.
    expect(
      def,
      `${CONSTRAINT} is missing from public.audit_event. Without it the database ` +
        'accepts any action string, and C-4.7 (actions are keys, never sentences) ' +
        'has no enforcement at all.',
    ).not.toBeNull();
    expect(def).toContain('action');
  });

  it('every key the code can write is allowed by the database', async () => {
    const allowed = new Set(keysIn((await constraintDefinition())!));
    const refused = [...AUDIT_ACTIONS].filter((a) => !allowed.has(a));
    expect(
      refused,
      'These keys are in AUDIT_ACTIONS and NOT in the database CHECK, so any ' +
        'write that records one fails on its audit insert and the whole ' +
        'transaction rolls back. The migration that widens the constraint has ' +
        'not been applied to this database, or was written from an older list.',
    ).toEqual([]);
  });

  it('reports keys the database allows and this branch does not know, without failing', async () => {
    const allowed = keysIn((await constraintDefinition())!);
    const known = new Set<string>(AUDIT_ACTIONS);
    const ahead = allowed.filter((a) => !known.has(a));
    if (ahead.length > 0) {
      // Expected while a unit's migration is applied and its branch is not yet
      // merged. Printed so it is visible in the run, never asserted on.
      console.log(
        `audit CHECK is ahead of this branch by ${ahead.length} key(s): ${ahead.sort().join(', ')}` +
          ' -- expected if a unit has applied its migration and not yet merged.',
      );
    }
    // The assertion is about the shape of the answer, not about the window:
    // the database must hold a well-formed superset, never a partial list.
    expect(allowed.length).toBeGreaterThanOrEqual(AUDIT_ACTIONS.length);
  });

  it('neither list holds a duplicate', async () => {
    const allowed = keysIn((await constraintDefinition())!);
    expect(new Set(allowed).size, 'the database CHECK repeats a key').toBe(allowed.length);
    expect(new Set(AUDIT_ACTIONS).size, 'AUDIT_ACTIONS repeats a key').toBe(AUDIT_ACTIONS.length);
  });
});
