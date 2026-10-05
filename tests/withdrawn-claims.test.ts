import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ============================================================================
 * A WITHDRAWN CLAIM MAY BE MENTIONED. IT MAY NOT BE ASSERTED.
 * ============================================================================
 *
 * On 2026-10-01 a "37.8% drift over ten days" was recorded as a finding. It was a
 * sampling error: three runs taken in one morning read as a trend, with a
 * 53.4-minute run on the same branch and content hours later and a 52.4-minute run
 * the next day. The suite has a 63% spread, not a level.
 *
 * THE WITHDRAWAL WAS SWEPT BY HAND AND THE SWEEP LANDED NOWHERE. Six places were
 * corrected -- on a branch that has not merged. `main` carried the claim in SEVEN
 * places: this file's subject, the gate's own derivation comment, the complaint
 * text CI prints, the check script's header, the workflow step comment, the
 * CLAUDE.md law, and three passages in PROJECT-STATE.
 *
 *   A gate asserting the absence of a withdrawn claim in ONE location does not
 *   cover the claim's spread. A sweep executed by hand misses copies -- and a
 *   sweep executed on the wrong branch reaches none.
 *
 * SO THIS WALKS THE TREE. It does not forbid the tokens: a record must be able to
 * say what was withdrawn, or the withdrawal cannot be read. It requires that every
 * occurrence sits WITH its withdrawal -- a positive property, checkable, and not a
 * denylist of phrasings somebody will route around.
 */
const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * The withdrawn claim's distinctive tokens. Nothing else in this project uses them.
 *
 * TWO PATTERNS, AND THE SECOND IS WHY. The first version was
 * `/37\.8|38%\s*drift/` -- which requires the number BEFORE the word, and so missed
 * `## THE SUITE DRIFTED 38% AND NOTHING WAS COMPARING IT TO ANYTHING`, a heading on
 * `main` asserting the claim at the top of the very section that records its
 * withdrawal. The gate walked the whole tree and passed over it.
 *
 * **A pattern is a claim about the forms a thing takes.** This one now matches the
 * figure anywhere, and "drift" within forty characters of "38%" in EITHER order.
 */
const WITHDRAWN_PATTERNS = [/37\.8/i, /38\s*%[^.]{0,40}?drift|drift\w*[^.]{0,40}?38\s*%/i];

/**
 * Words that mark a mention as a withdrawal rather than an assertion.
 *
 * Deliberately generous: the cost of accepting a borderline withdrawal is low, and
 * the cost of a gate nobody can satisfy is that it gets deleted.
 */
const WITHDRAWAL = new RegExp(
  [
    'did not happen',
    'does not exist',
    'did not exist',
    'turned out not',
    'not to be real',
    'was not real',
    'withdrawn',
    'sampling error',
    'no drift',
    'not a level',
    'had not happened',
    'misread',
    'once read',
    'first written for',
    'first reported',
    'read as a',
    'i read',
    'refuted',
    'never happened',
  ].join('|'),
  'i',
);

/** How far either side of a mention its withdrawal may sit. One paragraph. */
const WINDOW = 600;

/**
 * Files that may carry the tokens with no withdrawal beside them. NAMED, with the
 * reason, because silence about a file is a claim about it.
 */
const EXEMPT = new Map<string, string>([
  [
    'tests/withdrawn-claims.test.ts',
    'This file. It defines the tokens it searches for, so it necessarily contains them.',
  ],
]);

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo']);

/**
 * Every text file in the tree. BROADER THAN CODE, deliberately: the claim spread
 * into Markdown, YAML and JavaScript, and a scan confined to source would have
 * missed five of the seven places it actually reached.
 *
 * Resolved from `import.meta.url`, never the working directory -- a gate that
 * resolves its own subject relative to the caller's cwd reads every file as absent
 * from anywhere else and passes by comparing nothing.
 */
function textFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir === '' ? '.' : dir), {
      withFileTypes: true,
    })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const rel = dir === '' ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(md|ts|tsx|mts|mjs|js|yml|yaml|sql|json)$/.test(entry.name)) found.push(rel);
    }
  };
  walk('');
  return found.sort();
}

/** Mentions in one file that have no withdrawal within WINDOW characters. */
function assertionsIn(contents: string): number[] {
  const lines: number[] = [];
  for (const source of WITHDRAWN_PATTERNS) {
    const pattern = new RegExp(source.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(contents)) !== null) {
      const from = Math.max(0, match.index - WINDOW);
      const window = contents.slice(from, match.index + WINDOW);
      if (!WITHDRAWAL.test(window)) {
        const line = contents.slice(0, match.index).split('\n').length;
        if (!lines.includes(line)) lines.push(line);
      }
    }
  }
  return lines.sort((a, b) => a - b);
}

describe('the withdrawn drift claim', () => {
  it('found the tree at all — a walk that finds nothing passes vacuously', () => {
    const files = textFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('CLAUDE.md');
    expect(files).toContain('docs/PROJECT-STATE.md');
    expect(files).toContain('.github/workflows/ci.yml');
    expect(files).toContain('scripts/ci-suite-duration.mjs');
  });

  it('is asserted nowhere in the tree', () => {
    const offenders: string[] = [];

    for (const file of textFiles()) {
      if (EXEMPT.has(file)) continue;
      const contents = readFileSync(join(root, file), 'utf8');
      for (const line of assertionsIn(contents)) {
        offenders.push(`${file}:${line}`);
      }
    }

    expect(
      offenders,
      'These mention the withdrawn 37.8%/38% drift with no withdrawal beside them:\n' +
        offenders.map((o) => `  ${o}`).join('\n') +
        '\n\nThe drift did not happen: three runs from one morning were read as a ten-day ' +
        'trend, and runs of 53.4 and 52.4 minutes on the same content followed. Either say ' +
        'so beside the mention, or remove it. A gate must not carry a withdrawn finding, ' +
        'and neither must a law or a record.',
    ).toEqual([]);
  });

  it('would catch an assertion — the scan can fail', () => {
    // A scan that has never seen a positive is a scan nobody has tested.
    expect(assertionsIn('the suite drifted 37.8% over ten days')).toEqual([1]);
    expect(assertionsIn('a 38% drift went unremarked')).toEqual([1]);
  });

  it('catches the word before the number, which the first pattern missed', () => {
    // `## THE SUITE DRIFTED 38% AND NOTHING WAS COMPARING IT TO ANYTHING` was a
    // heading on main, asserting the claim at the top of the section recording its
    // withdrawal, and the first pattern walked past it because it required the
    // number first. A pattern is a claim about the forms a thing takes.
    expect(assertionsIn('THE SUITE DRIFTED 38% AND NOTHING WAS COMPARING IT')).toEqual([1]);
    expect(assertionsIn('the suite drifted by 38% over ten days')).toEqual([1]);
    // And it still accepts the same form carrying its withdrawal.
    expect(assertionsIn('THE SUITE DRIFTED 38% — it did not happen')).toEqual([]);
  });

  it('accepts a mention that carries its withdrawal', () => {
    expect(assertionsIn('the 37.8% drift did not happen')).toEqual([]);
    expect(assertionsIn('THE 38% DRIFT THIS WAS WRITTEN FOR DOES NOT EXIST')).toEqual([]);
    // And across a paragraph break, which is how the records actually read.
    expect(
      assertionsIn('A 37.8% increase was reported.\n\n' + 'x'.repeat(200) + '\nIt was withdrawn.'),
    ).toEqual([]);
  });

  it('names every exemption with its reason', () => {
    for (const [file, reason] of EXEMPT) {
      expect(reason.length, `${file} is exempt with no reason`).toBeGreaterThan(30);
    }
  });
});
