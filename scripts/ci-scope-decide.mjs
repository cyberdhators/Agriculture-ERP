/**
 * Writes the concurrency group for the test job to GITHUB_OUTPUT.
 *
 * Reads the changed-path list on stdin and asks `ci-changed-scope.mjs` — the
 * same module the Test step asks. Thin on purpose: the decision lives in one
 * place and this file only moves it into a GitHub Actions output.
 *
 * THE GROUP IS A STATEMENT ABOUT WAITING, NEVER ABOUT WHAT RUNS. Nothing here
 * decides whether a step executes.
 */
import { appendFileSync, readFileSync } from 'node:fs';

import { groupFor, isDocumentsOnly, pathsOutsideDocuments } from './ci-changed-scope.mjs';

const changed = readFileSync(0, 'utf8').split('\n');
const unique = `docs-only-${process.env.GITHUB_RUN_ID ?? 'local'}`;

const group = groupFor(changed, unique);
const docsOnly = isDocumentsOnly(changed);

if (docsOnly) {
  console.log(`Documents only. The test job queues in its own group: ${group}`);
} else {
  console.log(`Needs staging, so the test job queues on ${group}. Paths outside documents:`);
  for (const path of pathsOutsideDocuments(changed)) console.log(`  ${path}`);
  if (pathsOutsideDocuments(changed).length === 0) {
    // The coarse case: an undetermined change set. Named rather than silent.
    console.log('  (none named — the changed set could not be determined, so staging is assumed)');
  }
}

const out = process.env.GITHUB_OUTPUT;
if (out) appendFileSync(out, `group=${group}\ndocs_only=${docsOnly}\n`);
