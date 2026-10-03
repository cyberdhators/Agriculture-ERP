/**
 * WHICH SUITE A CHANGE NEEDS, COMPUTED IN ONE PLACE.
 *
 * Two callers ask this question and they must not answer it separately:
 *
 *   1. The `scope` job, before anything runs, to decide which concurrency group
 *      the test job queues in -- `staging-tests` when the run will touch
 *      staging, a group of its own when it will not.
 *   2. The `Test` step itself, to decide which suite to run.
 *
 * They read this module. Neither reimplements it. Three guards each holding
 * their own copy of one project reference is how this repository learned that
 * two independent deciders of one fact drift apart, and the remedy there was
 * the same as the remedy here: one module, both callers.
 *
 * THE GROUP IS A STATEMENT ABOUT WAITING, NEVER ABOUT WHAT RUNS. The suite
 * choice stays in the Test step where it has always been. This module reports a
 * fact about a file list; the two callers use that fact for different purposes.
 *
 * WHY A SHARED MODULE AND NOT INLINE SHELL. `scripts/` is `.mjs` throughout and
 * already uses a module for shared logic. Inline shell copied into two places is
 * the fault this guard exists to prevent.
 */

/**
 * Paths that no test reads, so a change confined to them needs no database.
 *
 * `CLAUDE.md` is here deliberately and was argued twice (CI edits five and six,
 * 2026-09-11): the law file feels like it deserves more scrutiny, and a database
 * suite is not scrutiny of a document. Nothing in the full suite reads it.
 *
 * THIS LIST IS A CLAIM ABOUT THE WORLD and decays like any other. If a test
 * ever reads a file under `docs/`, this list is wrong and the short path will
 * skip the test that would have caught it.
 */
const DOCUMENT_ONLY = [/^docs\//, /^\.prettierignore$/, /^CLAUDE\.md$/];

/** True when every changed path is one no test reads. */
export function isDocumentsOnly(changedPaths) {
  const paths = changedPaths.filter((line) => line.trim() !== '');
  // An empty list is NOT documents-only. A change set we could not determine is
  // the unresolvable case, and the caller must treat it as needing everything.
  if (paths.length === 0) return false;
  return paths.every((path) => DOCUMENT_ONLY.some((pattern) => pattern.test(path)));
}

/**
 * The paths that are not documents, for a message that names them.
 *
 * A refusal that does not name its subject cannot be acted on, so the caller
 * prints these rather than only the verdict.
 */
export function pathsOutsideDocuments(changedPaths) {
  return changedPaths
    .filter((line) => line.trim() !== '')
    .filter((path) => !DOCUMENT_ONLY.some((pattern) => pattern.test(path)));
}

/**
 * The concurrency group the test job should queue in.
 *
 * DELIBERATELY COARSE, AND IT ERRS ONE WAY ONLY. Anything this module cannot
 * confidently call documents-only queues on `staging-tests`. The cost of being
 * wrong toward staging is a wait; the cost of being wrong away from it is two
 * runs holding the advisory lock at once.
 *
 * `uniqueGroup` is passed in rather than read from the environment here, so this
 * module stays a pure function of its inputs and the test can drive it.
 */
export function groupFor(changedPaths, uniqueGroup) {
  return isDocumentsOnly(changedPaths) ? uniqueGroup : 'staging-tests';
}

/** The group name that means "queues behind nothing": one run, one group. */
export const STAGING_GROUP = 'staging-tests';
