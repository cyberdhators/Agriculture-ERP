import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { makeTestPrisma, requireTestEnv } from './helpers/db';

/**
 * EVERY POSTGRES ENUM AGAINST THE TYPESCRIPT THAT MIRRORS IT.
 *
 * A seam of the commonest shape in this project: one fact -- the set of values
 * a column may hold -- written in a migration and again in a constant. The
 * census of 2026-09-20 found twenty-four enums, seventeen with a shared
 * constant and no drift between them, and seven with no counterpart at all.
 *
 * WHY THIS IS GATED AND MOST CLEAN SEAMS ARE NOT. The exposure test is not
 * "has it failed" but "can one side move alone, and does anything force the
 * other". For the seventeen the answer was no: adding an enum value means
 * writing a migration, and the only reason to write one is a feature whose
 * TypeScript you are editing the same hour. For the seven it is YES, by
 * construction -- their TypeScript lives in `apps/web/lib/fixtures` and their
 * SQL in `prisma/migrations`, different files with different owners, and
 * nothing connects them. That is the exact condition that produced the twelve
 * silent findings. See docs/PROJECT-STATE.md.
 *
 * DIRECTION MATTERS, AND BOTH ARE CHECKED.
 *   - A label in the database that TypeScript does not know: a row can hold a
 *     value no type admits, and the screen renders whatever it renders.
 *   - A value in TypeScript the database rejects: an insert fails at runtime.
 * Equality catches both. The two older tests that compare enums by CONTAINMENT
 * (visits, directories) are deliberate and stay as they are; this one is
 * stricter because these constants are the whole definition, not a subset.
 *
 * THE UNPAIRED MAP IS ITSELF A CLAIM, so it must resolve: naming an enum that
 * does not exist fails here. An exclusion that matches nothing is
 * indistinguishable from one doing its job -- the manifest carried exactly that
 * for six weeks.
 */
requireTestEnv();
const prisma = makeTestPrisma();
const root = fileURLToPath(new URL('..', import.meta.url));

/** Postgres enum -> the constant that defines the same set, and where it lives. */
const PAIRS: Readonly<Record<string, { file: string; constant: string }>> = {
  accuracy_flag: { file: 'packages/shared/src/farm.ts', constant: 'ACCURACY_FLAGS' },
  attachment_kind: { file: 'packages/shared/src/visit.ts', constant: 'ATTACHMENT_KINDS' },
  attachment_status: { file: 'packages/shared/src/visit.ts', constant: 'ATTACHMENT_STATUSES' },
  audit_actor_type: { file: 'packages/shared/src/audit.ts', constant: 'AUDIT_ACTOR_TYPES' },
  contact_status: { file: 'apps/web/lib/contact/api.ts', constant: 'CONTACT_STATUSES' },
  crop: { file: 'packages/shared/src/learning.ts', constant: 'CROPS' },
  directory_entry_type: {
    file: 'packages/shared/src/directory.ts',
    constant: 'DIRECTORY_ENTRY_TYPES',
  },
  financial_provider_class: {
    file: 'packages/shared/src/directory.ts',
    constant: 'FINANCIAL_PROVIDER_CLASSES',
  },
  language: { file: 'packages/shared/src/learning.ts', constant: 'LANGUAGES' },
  learning_topic: { file: 'packages/shared/src/learning.ts', constant: 'LEARNING_TOPICS' },
  listing_category: { file: 'apps/web/lib/fixtures/farmers.ts', constant: 'LISTING_CATEGORIES' },
  listing_unit: { file: 'apps/web/lib/fixtures/farmers.ts', constant: 'LISTING_UNITS' },
  registration_source: { file: 'packages/shared/src/farmer.ts', constant: 'REGISTRATION_SOURCES' },
  report_reason: { file: 'packages/shared/src/product-reports.ts', constant: 'REPORT_REASONS' },
  report_status: { file: 'packages/shared/src/product-reports.ts', constant: 'REPORT_STATUSES' },
  resource_format: { file: 'packages/shared/src/learning.ts', constant: 'RESOURCE_FORMATS' },
  sex: { file: 'packages/shared/src/farmer.ts', constant: 'SEXES' },
  user_role: { file: 'packages/shared/src/identity.ts', constant: 'USER_ROLES' },
  verification_decision: {
    file: 'packages/shared/src/verification.ts',
    constant: 'VERIFICATION_DECISIONS',
  },
  verification_status: {
    file: 'packages/shared/src/verification.ts',
    constant: 'VERIFICATION_STATES',
  },
  visit_topic: { file: 'packages/shared/src/visit.ts', constant: 'VISIT_TOPICS' },
};

/**
 * Enums with no constant to compare against, each with the reason. A reason,
 * not a shrug: every line here is a decision someone can disagree with.
 */
const NO_COUNTERPART: Readonly<Record<string, string>> = {
  listing_status:
    'A union type (fixtures/farmers.ts `ListingStatus`), not a value list, so there is nothing to compare at runtime. Pair it when the marketplace moves off fixtures.',
  notification_channel:
    'Nothing reads it yet: SMS notifications are C-15 and unbuilt. It becomes a pair the day a constant exists.',
  officer_status:
    "Written inline as z.enum(['active','inactive']) in identity.ts rather than as a named constant. Pair it if that ever gains a third value.",
};

/** `export const NAME = [ 'a', 'b' ] as const` -> the values. */
function constantValues(file: string, name: string): string[] | null {
  const source = readFileSync(join(root, file), 'utf8');
  const at = source.indexOf(`export const ${name}`);
  if (at === -1) return null;
  const open = source.indexOf('[', at);
  const close = source.indexOf(']', open);
  if (open === -1 || close === -1) return null;
  return [...source.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe('every Postgres enum matches the TypeScript that mirrors it', () => {
  it('found the enums at all, so this cannot pass by comparing nothing', async () => {
    const rows = await prisma.$queryRawUnsafe<{ typname: string }[]>(
      `SELECT DISTINCT t.typname FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
         JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'`,
    );
    expect(rows.length).toBeGreaterThan(15);
  });

  it('every enum is either paired with a constant or declared as having none', async () => {
    const rows = await prisma.$queryRawUnsafe<{ typname: string }[]>(
      `SELECT DISTINCT t.typname FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
         JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'`,
    );
    const unaccounted = rows
      .map((r) => r.typname)
      .filter((t) => !(t in PAIRS) && !(t in NO_COUNTERPART))
      .sort();
    expect(
      unaccounted,
      'these enums exist and this file says nothing about them. Pair each with the constant that ' +
        'defines the same set, or record in NO_COUNTERPART why there is none: ' +
        unaccounted.join(', '),
    ).toEqual([]);
  });

  it('every enum this file names still exists — a mapping that names nothing is the bug it guards', async () => {
    const rows = await prisma.$queryRawUnsafe<{ typname: string }[]>(
      `SELECT DISTINCT t.typname FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
         JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'`,
    );
    const live = new Set(rows.map((r) => r.typname));
    const ghosts = [...Object.keys(PAIRS), ...Object.keys(NO_COUNTERPART)]
      .filter((t) => !live.has(t))
      .sort();
    expect(
      ghosts,
      `these enums are named here and no longer exist in the database: ${ghosts.join(', ')}`,
    ).toEqual([]);
  });

  it('every named constant still exists where this file says it does', () => {
    const missing = Object.entries(PAIRS)
      .filter(([, where]) => constantValues(where.file, where.constant) === null)
      .map(([enumName, where]) => `${enumName} -> ${where.constant} in ${where.file}`);
    expect(
      missing,
      `renamed or moved, so the comparison below would silently check nothing: ${missing.join('; ')}`,
    ).toEqual([]);
  });

  it('each paired enum and its constant hold exactly the same set', async () => {
    const rows = await prisma.$queryRawUnsafe<{ typname: string; labels: string[] }[]>(
      `SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumlabel) AS labels
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' GROUP BY t.typname`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.typname, r.labels]));

    /*
     * ABSENCE IS NOT A RESULT, AND THIS GATE NEARLY MADE THAT MISTAKE.
     *
     * On 2026-09-20 this test failed once and passed three times after, with no
     * change to the code. The most likely cause is the read above returning
     * nothing on a database that had been timing out connection requests all
     * week: with `byName` empty, EVERY pair reports its whole constant as
     * "in TypeScript only" and the gate goes red for twenty-one enums at once.
     * A comparison against an empty answer is not a comparison. This refuses
     * to compare until the query has actually returned the enums being
     * compared, so a failed read fails as a failed read.
     */
    const absent = Object.keys(PAIRS).filter((e) => !byName[e]?.length);
    expect(
      absent,
      'the database returned no labels for these enums, so nothing below would be a real ' +
        `comparison -- read the connection, not the constants: ${absent.join(', ')}`,
    ).toEqual([]);

    const drift: string[] = [];
    for (const [enumName, where] of Object.entries(PAIRS)) {
      const inDb = [...(byName[enumName] ?? [])].sort();
      const inTs = [...(constantValues(where.file, where.constant) ?? [])].sort();
      const dbOnly = inDb.filter((v) => !inTs.includes(v));
      const tsOnly = inTs.filter((v) => !inDb.includes(v));
      if (dbOnly.length || tsOnly.length) {
        drift.push(
          `${enumName} vs ${where.constant}:` +
            (dbOnly.length ? ` in the database only [${dbOnly.join(', ')}]` : '') +
            (tsOnly.length ? ` in TypeScript only [${tsOnly.join(', ')}]` : ''),
        );
      }
    }
    expect(
      drift,
      'a value in the database that TypeScript does not know means a row can hold what no type ' +
        'admits; a value in TypeScript the database rejects means an insert fails at runtime. ' +
        `Both are here: ${drift.join(' | ')}`,
    ).toEqual([]);
  });
});
