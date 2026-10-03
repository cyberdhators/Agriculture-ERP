import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The officer edit screen's boundaries, read as source. Comments are stripped
 * first -- this file explains what it leaves out, and asserting on prose is how
 * a test forbids its own explanation.
 */
const web = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string) => readFileSync(join(web, relative), 'utf8');
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const EDIT = code('components/officer/OfficerFarmerEdit.tsx');
const BRANCH = code('components/farmers/FarmerEditByRole.tsx');
const DETAIL = code('components/officer/OfficerFarmerDetail.tsx');

describe('the route the detail screen links to now exists', () => {
  it('has a page, so “Edit details” is no longer a dead link', () => {
    expect(() => read('app/(portal)/farmers/[id]/edit/page.tsx')).not.toThrow();
  });

  it('the detail screen still links to it', () => {
    expect(DETAIL).toContain('/edit');
  });

  it('an officer gets the correction form; every other role keeps the dossier', () => {
    expect(BRANCH).toMatch(
      /role === 'officer'\s*\?\s*<OfficerFarmerEdit id=\{id\} \/>\s*:\s*<FarmerDossier id=\{id\} \/>/,
    );
  });
});

describe('it cannot be used to do an administrator’s job', () => {
  it.each(['verifyFarmer', 'rejectFarmer', 'mergeFarmer', 'reassign', 'removeFarmer'])(
    'never calls %s',
    (fn) => {
      expect(EDIT).not.toContain(fn);
    },
  );

  it('does not resubmit on save — that is a separate, deliberate action', () => {
    expect(EDIT).not.toContain('resubmitFarmer');
  });

  it('sends the body through the shared strict schema before the route sees it', () => {
    expect(EDIT).toContain('patchFarmerSchema.safeParse');
  });
});

describe('scoping stays the server’s', () => {
  it('loads one farmer by id, never a list it narrows on the client', () => {
    expect(EDIT).toContain('getFarmer(id)');
    expect(EDIT).not.toContain('listFarmers(');
  });

  it('runs no ownership comparison of its own', () => {
    expect(EDIT).not.toMatch(/caseload_officer_id\s*===/);
    expect(EDIT).not.toMatch(/registered_by\s*===/);
  });

  it('treats 404 as not-found rather than as a session problem', () => {
    expect(EDIT).toMatch(/status === 404/);
    expect(EDIT).not.toMatch(/sign in again/i);
  });

  it('never sends a payam the officer chose freely — only their own', () => {
    expect(EDIT).toContain('myPayamId');
    expect(EDIT).not.toMatch(/payam_id:\s*draft\./);
  });
});

describe('the form only shows what the route accepts', () => {
  it('offers no verification control — reading the status to label it is not setting it', () => {
    // `verification_status` is READ on this screen, to say "Rejected" or
    // "Pending verification" above the form. Forbidding the word outright
    // would forbid the label; what must never happen is the screen SETTING it,
    // either as a patch key or as an input the officer can change.
    expect(EDIT).not.toMatch(/verification_status:\s*/);
    expect(EDIT).not.toMatch(/set\(\{\s*verification_status/);
    for (const word of ['Verify', 'Reject as', 'Approve']) {
      expect(EDIT).not.toContain(word);
    }
  });

  it('renders the national ID field only when the route sent the key', () => {
    expect(EDIT).toContain('mayEditNationalId');
  });

  it('never masks the national ID', () => {
    expect(EDIT).not.toContain('••');
    expect(EDIT).not.toMatch(/slice\(-4\)/);
  });
});
