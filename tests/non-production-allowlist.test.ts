import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  NON_PRODUCTION_PROJECT_REFS,
  allNamesAllowed,
  connectionNamesListedProject,
  namesNotAllowed,
} from '../scripts/non-production-projects.mjs';

/**
 * THE ALLOWLIST IS CLOSED, AND CLOSED IS THE PROPERTY THAT MATTERS.
 *
 * Three guards each held their own `STAGING_PROJECT_REF` literal and compared
 * against it. Correct, and the wrong shape: three copies drift, and the question
 * each was asking -- "may I destroy this database?" -- is not answered by
 * equality with one name but by membership of a list somebody has classified.
 *
 * THE LIST IS EMPTY TODAY. An empty allowlist refuses every target, which is the
 * safe state: it is exactly the behaviour T2 gave the three guards with
 * unconditional throws (docs/DECISIONS.md, "Staging is production"). So the
 * refusal direction is trivially true of the committed list, and a guard that
 * refuses everything passes every refusal test. That is the trap this file is
 * written around.
 *
 * THE ACCEPTANCE DIRECTION IS PROVED ON THE MATCHER, NOT THE LIST. A test
 * cannot name a real project to accept -- no disposable project exists yet, and
 * no production reference may ever be written here. So the pure matcher
 * `connectionNamesListedProject` is exercised with a HYPOTHETICAL list in both
 * directions: a listed reference is admitted, an unlisted one refused. The
 * guards never pass a list -- they call the zero-argument wrappers over the
 * frozen committed constant -- so the policy stays committed while the logic is
 * proved both ways.
 *
 * NO PRODUCTION REFERENCE IS NAMED HERE, deliberately. The one project,
 * `xmmxbrxmfgodhpwolrvk`, is production; introducing it in a test would make
 * this file a place it is written down. The property that protects production
 * is tested instead: an unclassified reference is refused, whatever it is.
 */
const mjs = fileURLToPath(new URL('../scripts/non-production-projects.mjs', import.meta.url));

/** References that are not, and will not be, real projects. */
const HYPOTHETICAL = 'aaaaaaaaaaaaaaaaaaaa';
const UNLISTED = 'zzzzzzzzzzzzzzzzzzzz';
// No user:password part: only the project reference matters to these checks,
// and a credential-shaped fixture is itself a secret-scan finding (CLAUDE.md:
// "a fixture that describes a secret finding is written in the idiom the
// scanner hunts"). It turned main's verify job red from #138 on (2026-10-09).
const uri = (ref: string) => `postgresql://db.${ref}.example.invalid:5432/postgres`;

describe('the non-production allowlist', () => {
  it('is empty today — the safe state, refusing every target including production', () => {
    // When a disposable project exists, its reference is added here and this
    // expectation changes deliberately, in the same commit.
    expect(NON_PRODUCTION_PROJECT_REFS).toEqual([]);
  });

  it('cannot be extended at run time', () => {
    expect(Object.isFrozen(NON_PRODUCTION_PROJECT_REFS)).toBe(true);
    expect(() => {
      (NON_PRODUCTION_PROJECT_REFS as string[]).push(UNLISTED);
    }).toThrow();
    expect(NON_PRODUCTION_PROJECT_REFS).not.toContain(UNLISTED);
  });

  it('the matcher ADMITS a listed reference (the acceptance direction)', () => {
    // Proved on a hypothetical list so the committed list can stay empty and
    // name no real project. This is the half that an all-refusing guard would
    // pass without, and the reason it is here.
    expect(connectionNamesListedProject(uri(HYPOTHETICAL), [HYPOTHETICAL])).toBe(true);
  });

  it('the matcher REFUSES a reference absent from the list it is given', () => {
    expect(connectionNamesListedProject(uri(UNLISTED), [HYPOTHETICAL])).toBe(false);
    // A mixed pair must refuse, or a guard passes while half-pointed elsewhere.
    expect(connectionNamesListedProject(uri(HYPOTHETICAL), [HYPOTHETICAL])).toBe(true);
    expect(connectionNamesListedProject(uri(UNLISTED), [HYPOTHETICAL])).toBe(false);
  });

  it('the matcher refuses absent and empty values rather than treating them as harmless', () => {
    expect(connectionNamesListedProject(undefined, [HYPOTHETICAL])).toBe(false);
    expect(connectionNamesListedProject('', [HYPOTHETICAL])).toBe(false);
  });

  it('with the committed (empty) list, the wrappers refuse every target', () => {
    expect(allNamesAllowed([uri(HYPOTHETICAL)])).toBe(false);
    expect(allNamesAllowed([uri(UNLISTED), uri(UNLISTED)])).toBe(false);
    expect(namesNotAllowed({ DATABASE_URL: uri(HYPOTHETICAL), DIRECT_URL: uri(UNLISTED) })).toEqual(
      ['DATABASE_URL', 'DIRECT_URL'],
    );
    expect(namesNotAllowed({ DATABASE_URL: undefined })).toEqual(['DATABASE_URL']);
    expect(namesNotAllowed({ DATABASE_URL: '' })).toEqual(['DATABASE_URL']);
  });

  it('takes its list from committed literals, never from anything at run time', () => {
    // The protection is that this cannot be influenced by whoever sets the
    // environment. Asserted against the source, because the absence of a read
    // is not observable from the module's behaviour.
    const source = readFileSync(mjs, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const forbidden of ['process.env', 'argv', 'readFileSync', 'require(']) {
      expect(source, `the allowlist module reads ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('is the only place the list is written down', () => {
    // Three copies drift. If a guard grows its own literal again, this fails.
    // Vacuous while the list is empty; it becomes live the moment a reference
    // is added, which is exactly when a stray copy would start to matter.
    for (const file of ['scripts/db-reset.mjs', 'tests/helpers/principals.ts']) {
      const source = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8');
      for (const ref of NON_PRODUCTION_PROJECT_REFS) {
        expect(source, `${file} carries its own copy of ${ref}`).not.toContain(ref);
      }
    }
  });

  it('never names the one production project', () => {
    // The guards' prose may mention it as the thing to exclude; the LIST may not
    // contain it. This is the assertion that would fail if someone "fixed" the
    // empty list by pasting the only project reference they could find.
    expect(NON_PRODUCTION_PROJECT_REFS).not.toContain('xmmxbrxmfgodhpwolrvk');
  });
});
