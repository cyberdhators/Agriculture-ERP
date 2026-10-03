/**
 * Exits 0 when every changed path on stdin is one no test reads, 1 otherwise.
 *
 * The Test step's half of the shared decision. Asks `ci-changed-scope.mjs`, the
 * same module the `scope` job asks, so the suite choice and the concurrency group
 * cannot be computed two different ways.
 *
 * An undetermined change set exits 1 — needing everything, never nothing.
 */
import { readFileSync } from 'node:fs';

import { isDocumentsOnly } from './ci-changed-scope.mjs';

process.exit(isDocumentsOnly(readFileSync(0, 'utf8').split('\n')) ? 0 : 1);
