import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * A FUNCTION THAT RETURNS `void` CANNOT BE READ BACK AS A QUERY (2026-11-03).
 *
 * `SELECT pg_advisory_xact_lock(...)` through `$queryRawUnsafe` makes the
 * driver deserialise a `void` column and fail (Prisma P2010) -- found by
 * damage twice: the vault secret update in the cron installers and the saved
 * search lock, which answered 500 on every save. A void call is either run
 * with `$executeRawUnsafe` or wrapped (`SELECT 1 AS locked FROM (SELECT ...) l`).
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const VOID_FUNCTIONS = ['pg_advisory_xact_lock', 'pg_advisory_lock', 'pg_notify'];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe('no void-returning function is selected bare through $queryRawUnsafe', () => {
  it('every such call is wrapped or executed', () => {
    const offenders: string[] = [];
    for (const file of [...sources(join(web, 'app')), ...sources(join(web, 'lib'))]) {
      const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      for (const m of text.matchAll(
        /\$queryRawUnsafe(?:<[^>]*>)?\(\s*`\s*SELECT\s+(\w+(?:\.\w+)?)\s*\(/g,
      )) {
        const fn = m[1] ?? '';
        if (VOID_FUNCTIONS.includes(fn) || fn === 'vault.update_secret') {
          offenders.push(`${relative(web, file).replace(/\\/g, '/')}: SELECT ${fn}(...)`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
