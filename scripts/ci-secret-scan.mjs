/**
 * THE BLOCKING SECRET SCAN: THIS BRANCH'S COMMITS, PLUS THE WORKING TREE.
 *
 * Run by `.github/workflows/ci.yml`. Keeps the logic here rather than in YAML so
 * that the parts that can be wrong can also be tested -- the range resolver and
 * the finding renderer each have their own suite.
 *
 * ================================================================
 * WHY THIS IS NOT A SCAN OVER ALL HISTORY ANY MORE
 * ================================================================
 *
 * It was, and the result was a gate that could not be made green. gitleaks with
 * no `--log-opts` walks every ref the runner has fetched, and `fetch-depth: 0`
 * fetches all of them -- so one secret on one unmerged branch turned EVERY
 * branch red. Observed, not reasoned: #107's leak count rose from one to two
 * because #108 was pushed, while #107's own two commits contained no credential
 * pattern of any kind. A branch's verdict changed because a different branch
 * existed.
 *
 * A gate that can never be green is read as noise and then bypassed, and the
 * first casualty was nearly the Secrets law itself -- a merge order that began
 * by merging past this red scan in order to land a law.
 *
 * So the block is on what the branch ADDS, and full history moved to
 * `.github/workflows/secret-audit.yml` on a schedule. The intent recorded on the
 * old checkout step survives: a secret added and then reverted WITHIN the branch
 * is still inside the branch's range, so "removed it in a later commit" is still
 * a finding. Only inherited history leaves.
 *
 * TWO PASSES, AND BOTH ARE NEEDED. The commit range reads history; the
 * `--no-git` pass reads the files as they stand. A secret that was never
 * committed but is present in the tree -- a generated file, a careless paste --
 * is invisible to the first and caught by the second.
 *
 * THE REPORT IS NEVER UPLOADED. It carries the matched value. It is parsed here
 * and dies with the runner; only locations are printed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

import { formatFindings } from './ci-secret-findings.mjs';
import { UnresolvableRange, rangeFor } from './ci-secret-scan-range.mjs';

const GITLEAKS = process.env.GITLEAKS_BIN ?? '/tmp/gitleaks';
const REPORT = '/tmp/gitleaks-report.json';

/** Runs gitleaks and returns its findings. Exit code 1 means findings, not error. */
function scan(args, label) {
  rmSync(REPORT, { force: true });
  console.log(`\n--- ${label} ---`);
  try {
    execFileSync(GITLEAKS, [...args, '--report-format', 'json', '--report-path', REPORT], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } catch (error) {
    // gitleaks exits 1 when it finds something. Any other code is a real
    // failure -- the binary missing, a bad config -- and must not be read as
    // "no findings", which is the empty-set fault this file is careful about.
    if (error.status !== 1) {
      console.error(
        `\nThe secret scan could not run (${label}): gitleaks exited ${error.status}. ` +
          'Nothing was scanned, and this is NOT a clean result.',
      );
      process.exit(2);
    }
  }
  if (!existsSync(REPORT)) return [];
  const text = readFileSync(REPORT, 'utf8').trim();
  rmSync(REPORT, { force: true });
  return text === '' ? [] : JSON.parse(text);
}

const event = process.env.GITHUB_EVENT_NAME;
const baseRef = process.env.GITHUB_BASE_REF;
const beforeSha = process.env.SCAN_BEFORE_SHA;

let range;
try {
  range = rangeFor({ event, baseRef, beforeSha });
} catch (error) {
  if (error instanceof UnresolvableRange) {
    console.error(`\nSECRET SCAN REFUSED\n\n${error.message}`);
    process.exit(2);
  }
  throw error;
}

console.log(`Blocking scan. Event: ${event}. Commit range: ${range}`);

const CONFIG = ['--config', '.gitleaks.toml', '--redact', '--no-banner'];

const findings = [
  ...scan(['git', '.', ...CONFIG, '--log-opts', range], `commits in ${range}`),
  // `dir` reads the files as they stand, ignoring git. A secret present in the
  // tree but never committed is invisible to the range pass.
  ...scan(['dir', '.', ...CONFIG], 'working tree as it stands'),
];

if (findings.length === 0) {
  console.log('\nNo findings in this branch’s commits or in the working tree.');
  process.exit(0);
}

console.error(
  `\nSECRET SCAN FAILED — ${findings.length} finding(s). ` +
    'The matched values are deliberately not printed, and the report is not uploaded.\n',
);
console.error(formatFindings(findings));
console.error(
  '\nIf a finding is a false positive, add its fingerprint to .gitleaksignore ' +
    'with the reason on the line above it. CLAUDE.md: a false positive is the ' +
    "owner's deliberate decision, not a default a session sets.",
);
process.exit(1);
