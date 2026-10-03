/**
 * CLOSES THE LOOP: the group the test job waited in must match what it did.
 *
 * The `scope` job decides a group before anything runs; the Test step decides a
 * suite. Those are two uses of one fact, and they read the same module — but
 * "they read the same module" is an intention, and this is the assertion.
 *
 * If the group said no-staging and this step is about to run the full suite,
 * that contradiction is named here and the run fails. Leaving it to the staging
 * advisory lock would mean discovering it as a mysterious refusal in another run.
 *
 * WHAT THIS CHECKS AND WHAT IT DOES NOT. It compares DECISIONS, not sockets. A
 * step cannot observe whether a connection was opened without instrumenting
 * vitest.global-setup.ts, which is not this branch's work. So a pass means the
 * group and the suite agree — not that nothing connected.
 */
import { isDocumentsOnly } from './ci-changed-scope.mjs';
import { readFileSync } from 'node:fs';

const changed = readFileSync(0, 'utf8').split('\n');
const claimed = process.env.SCOPE_DOCS_ONLY;
const actual = isDocumentsOnly(changed);

if (claimed !== 'true' && claimed !== 'false') {
  console.error(
    `The scope job's docs_only output did not reach this step: received ` +
      `${JSON.stringify(claimed)}. Refusing to assume either value — a check that ` +
      'cannot determine what to compare must fail, not report clean.',
  );
  process.exit(2);
}

if ((claimed === 'true') !== actual) {
  console.error(
    'CONTRADICTION between the concurrency group and the suite about to run.\n\n' +
      `  the scope job decided documents_only = ${claimed}\n` +
      `  this step decided documents_only = ${actual}\n\n` +
      'Both read scripts/ci-changed-scope.mjs, so they cannot legitimately ' +
      'disagree: either the change set differed between the two jobs, or one of ' +
      'them was given a different file list. If the group said documents-only ' +
      'and the full suite runs, two runs can hold the staging advisory lock at ' +
      'once. Failing here rather than leaving the lock to discover it.',
  );
  process.exit(1);
}

console.log(`Group and suite agree: documents_only = ${actual}`);
