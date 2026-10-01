import { describe, expect, it } from 'vitest';

import {
  STAGING_GROUP,
  groupFor,
  isDocumentsOnly,
  pathsOutsideDocuments,
} from '../scripts/ci-changed-scope.mjs';

/**
 * ONE DECIDER FOR ONE FACT, AND IT ERRS TOWARD THE LOCK.
 *
 * The `scope` job and the `Test` step both need to know whether a change needs
 * staging. They read this module rather than each computing it, because three
 * guards holding three copies of one project reference is how this repository
 * learned what two independent deciders of one fact do.
 *
 * WHAT MAY VARY IS HOW A CHECK WAITS, NEVER WHETHER IT SPEAKS. This module
 * chooses a concurrency group. It does not choose whether the test step runs --
 * that step is unconditional and must stay so.
 */
describe('the changed-scope decision', () => {
  it('calls a documents-only change documents-only', () => {
    expect(isDocumentsOnly(['docs/PROJECT-STATE.md', 'CLAUDE.md', '.prettierignore'])).toBe(true);
  });

  it('calls a mixed change not documents-only — per file, not per pull request', () => {
    expect(isDocumentsOnly(['docs/PROJECT-STATE.md', 'apps/web/app/page.tsx'])).toBe(false);
  });

  it('treats an undetermined change set as needing staging, never as needing nothing', () => {
    // ABSENT is not ZERO. An empty list means "we could not tell", and the cost
    // of erring toward the lock is a wait; the cost of erring away from it is two
    // runs holding the staging advisory lock at once.
    expect(isDocumentsOnly([])).toBe(false);
    expect(groupFor([], 'solo-run-1')).toBe(STAGING_GROUP);
    expect(isDocumentsOnly(['', '   '])).toBe(false);
  });

  it('queues a documents-only run in its own group, behind nothing', () => {
    expect(groupFor(['docs/a.md'], 'solo-run-1')).toBe('solo-run-1');
  });

  it('queues anything else on the staging group', () => {
    expect(groupFor(['prisma/schema.prisma'], 'solo-run-1')).toBe(STAGING_GROUP);
    expect(groupFor(['tests/sync.test.ts'], 'solo-run-1')).toBe(STAGING_GROUP);
    expect(groupFor(['.github/workflows/ci.yml'], 'solo-run-1')).toBe(STAGING_GROUP);
  });

  it('names the paths that took it off the short path', () => {
    // A refusal that does not name its subject only tells you to go looking.
    expect(pathsOutsideDocuments(['docs/a.md', 'apps/web/x.ts', 'scripts/y.mjs'])).toEqual([
      'apps/web/x.ts',
      'scripts/y.mjs',
    ]);
    expect(pathsOutsideDocuments(['docs/a.md'])).toEqual([]);
  });

  it('does not treat a path merely containing "docs/" as a document', () => {
    expect(isDocumentsOnly(['apps/web/docs/page.tsx'])).toBe(false);
    expect(isDocumentsOnly(['CLAUDE.md.bak'])).toBe(false);
  });
});
