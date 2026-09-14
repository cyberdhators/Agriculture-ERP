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
 * It fails when either moves alone, in BOTH directions, which is the point --
 * a key in the code and not the database refuses a write at runtime, and a key
 * in the database and not the code is a permission nothing can use.
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

  it('every key the database allows is one the code can write', async () => {
    const allowed = keysIn((await constraintDefinition())!);
    const known = new Set<string>(AUDIT_ACTIONS);
    const orphaned = allowed.filter((a) => !known.has(a));
    expect(
      orphaned,
      'These keys are allowed by the database CHECK and are NOT in ' +
        'AUDIT_ACTIONS. Either a key was removed from the constant without a ' +
        'migration, or a migration invented one. A permission nothing can use ' +
        'is not harmless: it is the direction in which the two lists drift ' +
        'apart unnoticed.',
    ).toEqual([]);
  });

  it('the two lists are the same size, so neither holds a duplicate', async () => {
    const allowed = keysIn((await constraintDefinition())!);
    expect(new Set(allowed).size).toBe(allowed.length);
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    expect(new Set(allowed).size).toBe(new Set(AUDIT_ACTIONS).size);
  });
});
