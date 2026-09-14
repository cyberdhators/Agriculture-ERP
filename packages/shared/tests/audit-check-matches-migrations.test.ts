import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '../src/index';

/**
 * THE CAUSE, NOT THE SYMPTOM (docs/PROJECT-STATE.md, the eleventh instance).
 *
 * `tests/audit-actions-constraint.test.ts` compares AUDIT_ACTIONS to the CHECK
 * in the live database. That is the right gate, and it goes red only once a
 * migration has been applied. #28's migration sat unapplied for eight days,
 * which is exactly when it was dangerous and exactly when no database could
 * see it.
 *
 * This test reads the migrations as text instead, so it fails on the branch
 * that writes the migration, before any database is touched. It asserts two
 * things:
 *
 *   1. The LAST migration that recreates the constraint lists exactly
 *      AUDIT_ACTIONS -- the constant and the SQL cannot drift apart.
 *   2. No migration that recreates the constraint removes a key an EARLIER one
 *      allowed. A CHECK can only be replaced, never extended, so a migration
 *      written against an older list silently narrows the constraint when it
 *      lands after a newer one. That is precisely what #28 would have done:
 *      twenty-two keys replacing forty.
 *
 * Pure: it reads files and compares two sources. No database.
 */

const migrationsDir = fileURLToPath(new URL('../../../prisma/migrations', import.meta.url));

const ADD = 'ADD CONSTRAINT "audit_event_action_known"';

/** Every migration that recreates the constraint, oldest first by folder name. */
function constraintMigrations(): { name: string; keys: string[] }[] {
  const out: { name: string; keys: string[] }[] = [];
  for (const name of readdirSync(migrationsDir).sort()) {
    if (!/^\d{14}_/.test(name)) continue;
    let sql: string;
    try {
      sql = readFileSync(`${migrationsDir}/${name}/migration.sql`, 'utf8');
    } catch {
      continue;
    }
    const at = sql.indexOf(ADD);
    if (at === -1) continue;
    // Only the keys inside this statement, not any elsewhere in the file.
    const statement = sql.slice(at, sql.indexOf(';', at));
    out.push({ name, keys: [...statement.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]!) });
  }
  return out;
}

describe('the audit action CHECK in the migrations matches AUDIT_ACTIONS', () => {
  const migrations = constraintMigrations();

  it('at least one migration creates the constraint', () => {
    expect(
      migrations.length,
      `No migration under prisma/migrations contains ${ADD}. Either the ` +
        'constraint is gone or this test is looking in the wrong place.',
    ).toBeGreaterThan(0);
  });

  it('the last one to recreate it lists exactly AUDIT_ACTIONS', () => {
    const last = migrations[migrations.length - 1]!;
    const inSql = [...last.keys].sort();
    const inCode = [...AUDIT_ACTIONS].sort();
    expect(
      inSql,
      `${last.name} is the last migration to recreate the constraint, so its ` +
        'list is what a fresh database ends up with. It must equal ' +
        'AUDIT_ACTIONS exactly. Adding an action key means editing the ' +
        'constant, CONVENTIONS.md section 5.2.2 and a new migration in the ' +
        'same change -- never the constant alone.',
    ).toEqual(inCode);
  });

  it('no migration narrows the constraint a later-dated one has widened', () => {
    // Walked oldest to newest: the set may only grow. A migration whose list
    // is missing a key an earlier migration allowed would, when applied,
    // refuse writes that already worked.
    const seen = new Set<string>();
    const narrowing: string[] = [];
    for (const m of migrations) {
      const keys = new Set(m.keys);
      const removed = [...seen].filter((k) => !keys.has(k));
      if (removed.length > 0) {
        narrowing.push(`${m.name} drops ${removed.length}: ${removed.sort().join(', ')}`);
      }
      for (const k of keys) seen.add(k);
    }
    expect(
      narrowing,
      'A CHECK constraint can only be replaced, never extended, so every ' +
        'migration that recreates this one must carry the FULL list as of its ' +
        'own date. A migration dated before another but applied after it will ' +
        'silently narrow the constraint, and every write recording one of the ' +
        'removed actions then fails on its audit insert. This is the eleventh ' +
        'instance; see docs/PROJECT-STATE.md.',
    ).toEqual([]);
  });
});
