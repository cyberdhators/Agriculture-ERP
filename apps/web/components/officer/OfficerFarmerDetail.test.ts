import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * WHAT THE OFFICER'S FARMER DETAIL MUST NOT CONTAIN, read as source.
 *
 * The arithmetic lives in `lib/officer/farmer-detail.test.ts`; this pins the
 * structural facts: which screen each role gets, which routes this one calls,
 * and that no administrator decision has appeared on it. Comments are stripped
 * first -- this file EXPLAINS what it leaves out, and asserting on prose is how
 * a test ends up forbidding its own explanation (three instances in
 * PROJECT-STATE).
 */
const web = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string) => readFileSync(join(web, relative), 'utf8');
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const DETAIL = code('components/officer/OfficerFarmerDetail.tsx');
const BRANCH = code('components/farmers/FarmerDetailByRole.tsx');
const DOSSIER = read('components/farmers/FarmerDossier.tsx');

describe('/farmers/[id] gives each role its own screen', () => {
  it('an officer receives the officer detail; everyone else the dossier', () => {
    expect(BRANCH).toMatch(
      /role === 'officer'\s*\?\s*<OfficerFarmerDetail id=\{id\} \/>\s*:\s*<FarmerDossier id=\{id\} \/>/,
    );
  });

  it('the page renders the branch, not either screen directly', () => {
    const page = read('app/(portal)/farmers/[id]/page.tsx');
    expect(page).toContain('FarmerDetailByRole');
    expect(page).not.toContain('<FarmerDossier');
  });
});

describe('no administrator decision reaches the officer screen', () => {
  it.each([
    'verifyFarmer',
    'rejectFarmer',
    'mergeFarmer',
    'reassign',
    'removeFarmer',
    'deleteFarmer',
  ])('never calls %s', (fn) => {
    expect(DETAIL).not.toContain(fn);
  });

  it('offers no button whose label is a supervisor’s decision', () => {
    for (const label of ['Verify', 'Reject', 'Merge', 'Reassign', 'Remove', 'Delete']) {
      expect(DETAIL).not.toMatch(new RegExp(`>\\s*${label}`));
    }
  });

  it('the only write it performs is resubmission', () => {
    expect(DETAIL).toContain('resubmitFarmer');
    expect(DETAIL).toMatch(/actions\.canResubmit/);
  });
});

describe('it reads only officer-safe routes', () => {
  it('uses the per-farmer farm and visit lists, which accept every role', () => {
    expect(DETAIL).toContain('listFarmerFarms');
    expect(DETAIL).toContain('listFarmerVisits');
  });

  it('never touches the administrator map', () => {
    // GET /api/farms/geojson is admin and supervisor only.
    expect(DETAIL).not.toContain('geojson');
    expect(DETAIL).not.toContain('listFarmGeoJson');
  });

  it('fetches one farmer by id and never a national list it narrows afterwards', () => {
    expect(DETAIL).toContain('getFarmer(id)');
    expect(DETAIL).not.toContain('listFarmers(');
  });

  it('runs no ownership check of its own — the WHERE clause is the gate', () => {
    expect(DETAIL).not.toMatch(/caseload_officer_id\s*===/);
    expect(DETAIL).not.toMatch(/registered_by\s*===/);
  });
});

describe('absence and masking', () => {
  it('never masks the national ID', () => {
    expect(DETAIL).not.toContain('••');
    expect(DETAIL).not.toMatch(/slice\(-4\)/);
  });

  it('renders no em dash placeholder for a missing value', () => {
    expect(DETAIL).not.toContain("'—'");
    expect(DETAIL).not.toContain('>—<');
  });

  it('treats a 404 as not-found rather than as a sign-in problem', () => {
    expect(DETAIL).toMatch(/status === 404/);
    expect(DETAIL).not.toMatch(/sign in again/i);
  });
});

describe('the administrator dossier keeps everything it had', () => {
  it('still holds the decisions the officer screen does not', () => {
    for (const fn of ['verifyFarmer', 'rejectFarmer', 'mergeFarmer']) {
      expect(DOSSIER).toContain(fn);
    }
  });
});
