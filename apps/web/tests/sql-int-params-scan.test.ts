import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * RAW-QUERY NUMBERS ARRIVE AS BIGINT (2026-10-29). docs/DECISIONS.md,
 * "A raw-query number is a bigint: cast it where a function wants int".
 *
 * Prisma's $queryRawUnsafe / $executeRawUnsafe send a JavaScript integer as
 * a bigint parameter. Postgres has no implicit cast from bigint to integer,
 * so a function whose argument is `integer` -- left(text, int), make_interval,
 * lpad, repeat, generate_series... -- has no overload to match and the query
 * fails with "function left(text, bigint) does not exist". Found by damage
 * twice: make_interval (#216) and left() in announcement processing, which
 * answered 500 on production.
 *
 * This reads every server source file and fails when such a function receives
 * a `$n` parameter that is not cast on the spot (`$n::int`). LIMIT, OFFSET and
 * comparisons accept bigint and are not this class.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const repo = join(web, '..', '..');

/** Functions with an `integer` argument and no bigint overload. */
const INT_ARGUMENT_FUNCTIONS = [
  'make_interval',
  'make_date',
  'make_time',
  'make_timestamp',
  'make_timestamptz',
  'left',
  'right',
  'substr',
  'substring',
  'lpad',
  'rpad',
  'repeat',
  'overlay',
  'split_part',
  'chr',
  'generate_series',
  'round',
  'trunc',
  'width_bucket',
  'ntile',
  'lag',
  'lead',
  'array_fill',
] as const;

/**
 * Every `$n` passed into one of those functions without a cast directly after
 * it. `text` is any source text; each call's arguments are read to the
 * matching close bracket, so a call over several lines is read whole.
 */
function uncastIntParameters(text: string): { fn: string; param: string }[] {
  const found: { fn: string; param: string }[] = [];
  const call = new RegExp(`\\b(${INT_ARGUMENT_FUNCTIONS.join('|')})\\s*\\(`, 'gi');
  for (let m = call.exec(text); m; m = call.exec(text)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') depth -= 1;
      i += 1;
    }
    const args = text.slice(start, i - 1);
    for (const p of args.matchAll(/\$(\d+)(?!\d)(?!\s*::)/g)) {
      found.push({ fn: (m[1] as string).toLowerCase(), param: `$${p[1]}` });
    }
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'tests') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
  }
  return out;
}

describe('the scanner itself', () => {
  it('finds an uncast parameter, across lines and inside nested calls', () => {
    expect(uncastIntParameters(`left(btrim(name), $6)`)).toEqual([{ fn: 'left', param: '$6' }]);
    expect(uncastIntParameters(`make_interval(\n  mins => $3\n)`)).toEqual([
      { fn: 'make_interval', param: '$3' },
    ]);
    expect(uncastIntParameters(`generate_series(1, $12)`)).toEqual([
      { fn: 'generate_series', param: '$12' },
    ]);
  });

  it('accepts a cast parameter and ignores parameters outside those functions', () => {
    expect(uncastIntParameters(`left(btrim(name), $6::int)`)).toEqual([]);
    expect(uncastIntParameters(`make_interval(mins => $3 ::int)`)).toEqual([]);
    expect(uncastIntParameters(`WHERE id = $1 LIMIT $2`)).toEqual([]);
    expect(uncastIntParameters('const s = `${left}`; left(a, b)')).toEqual([]);
  });
});

describe('no raw query passes a bigint parameter to an integer argument', () => {
  const roots = [join(web, 'lib'), join(web, 'app'), join(repo, 'scripts')];
  const files = roots.flatMap(sourceFiles);

  it('reads the server source (a scan of nothing is not a pass)', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.replaceAll('\\', '/').endsWith('lib/api/announcements.ts'))).toBe(
      true,
    );
  });

  it('casts every such parameter with ::int', () => {
    const offenders = files.flatMap((file) =>
      uncastIntParameters(readFileSync(file, 'utf8')).map(
        (f) => `${relative(repo, file).replaceAll('\\', '/')}: ${f.fn}(... ${f.param})`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
