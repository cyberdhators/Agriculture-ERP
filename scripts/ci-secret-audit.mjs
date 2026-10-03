/**
 * THE FULL-HISTORY AUDIT. Reports locations; never the matched value.
 *
 * Run by `.github/workflows/secret-audit.yml`, weekly and on demand. Deliberately
 * NOT a merge gate: a blocking scan over all history cannot be made green once
 * anything has ever leaked, and a gate that can never be green is bypassed.
 *
 * WHAT IT SCANS, AND WHAT THAT DEPENDS ON. All of it — every ref the runner has
 * fetched. `fetch-depth: 0` fetches heads and tags, not `refs/pull/*`, so this
 * answer is a property of that ref set and a local `git log --all` scan may see
 * commits this does not.
 *
 * `.gitleaksignore` accounts for findings that have been looked at and decided
 * about, each with its reason on the line above it. Entries are honoured by
 * gitleaks itself; whether it reads the file while `--config` is also passed is
 * not assumed here — the step prints the counts both before and after so the
 * difference is visible rather than inferred.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

import { formatFindings } from './ci-secret-findings.mjs';

const GITLEAKS = process.env.GITLEAKS_BIN ?? '/tmp/gitleaks';
const REPORT = '/tmp/gitleaks-audit.json';

rmSync(REPORT, { force: true });

try {
  execFileSync(
    GITLEAKS,
    [
      'git',
      '.',
      '--config',
      '.gitleaks.toml',
      '--redact',
      '--no-banner',
      '--report-format',
      'json',
      '--report-path',
      REPORT,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
} catch (error) {
  // gitleaks exits 1 when it finds something. Any other code is a real failure --
  // a missing binary, an unreadable config -- and must never be read as "no
  // findings", which is the empty-set fault this repository has recorded.
  const status = error.status ?? -1;
  if (status !== 1) {
    console.error(
      `\nThe audit could not run: gitleaks exited ${status}. Nothing was scanned, ` +
        'and this is NOT a clean result.',
    );
    process.exit(2);
  }
}

const findings = existsSync(REPORT)
  ? (() => {
      const text = readFileSync(REPORT, 'utf8').trim();
      rmSync(REPORT, { force: true });
      return text === '' ? [] : JSON.parse(text);
    })()
  : [];

const ignoreFile = '.gitleaksignore';
const accounted = existsSync(ignoreFile)
  ? readFileSync(ignoreFile, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#')).length
  : 0;

console.log(`\n.gitleaksignore accounts for ${accounted} finding(s).`);
console.log(`The audit reports ${findings.length} finding(s) after that file was applied.\n`);

if (findings.length === 0) {
  console.log('No unaccounted findings in any history this runner can see.');
  process.exit(0);
}

console.log(formatFindings(findings));
console.log(
  '\nEach finding above is either a real credential — rotate it, and record the ' +
    'rotation — or a false positive to be accounted for in .gitleaksignore with ' +
    'its reason on the line above the fingerprint. CLAUDE.md: a false positive is ' +
    "the owner's deliberate decision, not a default a session sets.",
);
// Red, so a scheduled run is noticed. This workflow gates no merge.
process.exit(1);
