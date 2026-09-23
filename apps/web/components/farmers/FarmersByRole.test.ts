import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * WHO GETS WHICH SCREEN AT /farmers, AND WHAT NEITHER SCREEN OFFERS.
 *
 * Read as source rather than rendered: these components need a router, a
 * fetch and a provider, and the facts worth pinning are structural -- which
 * component a role receives, and that the officer's screen contains no
 * decision that belongs to a supervisor. A rendering test would assert the
 * same things more slowly and would not notice a button added tomorrow.
 *
 * The authorisation itself is not tested here because it is not here: the
 * route scopes an officer to `caseload_officer_id` server-side, and
 * `tests/forbidden-matrix.test.ts` proves what each role may call.
 */
const web = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string) => readFileSync(join(web, relative), 'utf8');

/**
 * Source with comments removed.
 *
 * These files EXPLAIN what they deliberately leave out -- "no print and no bulk
 * selection", "no search box" -- so scanning the raw text finds the words in
 * the sentence denying them and fails. Asserting on prose is how a test ends up
 * forbidding an explanation; it has caught this project three times now
 * (provider-secrets, and both suite guards). Strip the comments and assert on
 * code.
 */
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const BRANCH = code('components/farmers/FarmersByRole.tsx');
const OFFICER = code('components/officer/OfficerFarmers.tsx');
const REGISTER = read('components/farmers/FarmersRegister.tsx');

describe('/farmers gives each role its own screen', () => {
  it('an officer receives the officer caseload, and everyone else the register', () => {
    expect(BRANCH).toMatch(
      /role === 'officer'\s*\?\s*<OfficerFarmers \/>\s*:\s*<FarmersRegister \/>/,
    );
  });

  it('the page renders the branch rather than either screen directly', () => {
    const page = read('app/(portal)/farmers/page.tsx');
    expect(page).toContain('FarmersByRole');
    expect(page).not.toContain('<FarmersRegister');
    expect(page).not.toContain('<OfficerFarmers');
  });
});

describe('the officer screen offers no decision that is not the officer’s', () => {
  // C-6: verifying, rejecting, merging and reassigning are a supervisor's or an
  // administrator's. A button here would be a door that answers 403.
  it.each(['verify', 'reject', 'merge', 'reassign'])('offers no %s action', (word) => {
    const callable = new RegExp(`(onClick|href|fetch)[^\\n]*${word}`, 'i');
    expect(OFFICER).not.toMatch(callable);
  });

  it('offers resubmission only through the guarded helper, never as a bare status check', () => {
    expect(OFFICER).toContain('canResubmit');
    // A hand-rolled `status === 'rejected' &&` beside a button is how the rule
    // drifts from the route; the helper asks the shared transition table.
    expect(OFFICER).not.toMatch(/verification_status === 'rejected'/);
  });
});

describe('the officer screen does not reintroduce desk shapes', () => {
  it('has no print view, no bulk selection and no search box', () => {
    for (const shape of ['Print this view', 'bulk', 'SearchInput']) {
      expect(OFFICER).not.toContain(shape);
    }
  });

  it('offers no geography or duplicate-flag filter', () => {
    for (const filter of ['duplicate_flag', 'county:', 'payam:']) {
      expect(OFFICER).not.toContain(filter);
    }
  });

  it('never filters rows for authorisation — that is the route’s WHERE clause', () => {
    // A client-side predicate on the caseload pointer would be a screen
    // pretending to be a security control.
    expect(OFFICER).not.toMatch(/caseload_officer_id\s*===/);
    expect(OFFICER).not.toMatch(/\.filter\([^)]*caseload/);
  });
});

describe('the administrator register keeps what it had', () => {
  it('still offers print and selection, which the officer screen does not', () => {
    expect(REGISTER).toContain('Print this view');
    expect(REGISTER).toContain('selected');
  });
});
