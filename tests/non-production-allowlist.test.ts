import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  NON_PRODUCTION_PROJECT_REFS,
  allNamesAllowed,
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
 * Today the list has one member. That is not a weakness: two
 * known-non-production literals exclude production exactly as well as one does,
 * and an allowlist read from the environment excludes nothing at all.
 *
 * NO PRODUCTION REFERENCE IS NAMED HERE, and that is deliberate. No production
 * project exists -- `docs/DECISIONS.md` records the account holding exactly one
 * project when the Management API was last read -- and no production reference
 * appears anywhere in this repository. Introducing one in a test would make this
 * file the only place it is written down, which is worse than not asserting it.
 * The property that actually protects production is tested instead: an
 * unclassified reference is refused, whatever it is.
 */
const mjs = fileURLToPath(new URL('../scripts/non-production-projects.mjs', import.meta.url));

/** A reference that is not and will not be a real project. */
const UNLISTED = 'zzzzzzzzzzzzzzzzzzzz';
const uri = (ref: string) => `postgresql://role:secret@db.${ref}.example.invalid:5432/postgres`;

describe('the non-production allowlist', () => {
  it('is not empty — an empty list would refuse everything, including staging', () => {
    expect(NON_PRODUCTION_PROJECT_REFS.length).toBeGreaterThan(0);
  });

  it('cannot be extended at run time', () => {
    expect(Object.isFrozen(NON_PRODUCTION_PROJECT_REFS)).toBe(true);
    expect(() => {
      (NON_PRODUCTION_PROJECT_REFS as string[]).push(UNLISTED);
    }).toThrow();
    expect(NON_PRODUCTION_PROJECT_REFS).not.toContain(UNLISTED);
  });

  it('admits a listed project', () => {
    for (const ref of NON_PRODUCTION_PROJECT_REFS) {
      expect(allNamesAllowed([uri(ref), uri(ref)]), ref).toBe(true);
    }
  });

  it('REFUSES a reference that is not on it', () => {
    expect(allNamesAllowed([uri(UNLISTED)])).toBe(false);
    expect(namesNotAllowed({ DATABASE_URL: uri(UNLISTED) })).toEqual(['DATABASE_URL']);
  });

  it('refuses when only ONE of two connection strings is listed', () => {
    const listed = NON_PRODUCTION_PROJECT_REFS[0]!;
    expect(
      namesNotAllowed({ DATABASE_URL: uri(listed), DIRECT_URL: uri(UNLISTED) }),
      'a mixed pair must refuse, or a guard passes while half-pointed elsewhere',
    ).toEqual(['DIRECT_URL']);
  });

  it('refuses absent and empty values rather than treating them as harmless', () => {
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
    const refs = NON_PRODUCTION_PROJECT_REFS;
    for (const file of ['scripts/db-reset.mjs', 'tests/helpers/principals.ts']) {
      const source = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8');
      for (const ref of refs) {
        expect(source, `${file} carries its own copy of ${ref}`).not.toContain(ref);
      }
    }
  });
});
