/**
 * TURNS A GITLEAKS JSON REPORT INTO A REFUSAL THAT NAMES ITS SUBJECT.
 *
 * ================================================================
 * THE REPORT CONTAINS THE SECRET. THIS MODULE MUST NOT EMIT IT.
 * ================================================================
 *
 * gitleaks' JSON report carries the matched value in `Secret` and the
 * surrounding source line in `Match` and `Line`. Those fields are NEVER printed
 * and the report is NEVER uploaded as a CI artifact -- an artifact is a
 * downloadable copy of the credential, readable by anyone who can see the run.
 * The report is parsed in the step and discarded with the runner.
 *
 * What is printed is where to look: rule id, file, line, commit, and the
 * fingerprint needed to write a `.gitleaksignore` entry. None of those is the
 * secret.
 *
 * WHY IT PRINTS ANYTHING AT ALL. The scan this replaces ran at `--log-level
 * info` and printed `leaks found: 1` and nothing else -- no rule, no file, no
 * line. A real committed password sat behind that line for days while every
 * branch went red for it, and the gate could not say which file to open.
 *
 *   A REFUSAL THAT DOES NOT NAME ITS SUBJECT CANNOT BE ACTED ON;
 *   IT ONLY TELLS YOU TO GO LOOKING.
 */

/** Fields that carry the secret or its surrounding text. Never printed. */
const FORBIDDEN_FIELDS = ['Secret', 'Match', 'Line'];

/**
 * One finding, reduced to locations.
 *
 * Built by naming the fields to KEEP rather than the fields to drop: a future
 * gitleaks version adding a field that happens to carry the value cannot leak
 * through an allowlist, only through a denylist.
 */
export function locationOf(finding) {
  return {
    rule: finding.RuleID ?? '(no rule id in report)',
    file: finding.File ?? '(no file in report)',
    startLine: finding.StartLine ?? null,
    endLine: finding.EndLine ?? null,
    commit: finding.Commit ?? '(working tree)',
    fingerprint: finding.Fingerprint ?? '(no fingerprint in report)',
  };
}

/** Human-readable locations, one finding per block. Never the value. */
export function formatFindings(findings) {
  if (findings.length === 0) return 'No findings.';
  return findings
    .map((finding, index) => {
      const l = locationOf(finding);
      const lines =
        l.endLine && l.endLine !== l.startLine ? `${l.startLine}-${l.endLine}` : l.startLine;
      return [
        `Finding ${index + 1} of ${findings.length}`,
        `  rule        ${l.rule}`,
        `  file        ${l.file}`,
        `  line        ${lines ?? '(not reported)'}`,
        `  commit      ${l.commit}`,
        `  fingerprint ${l.fingerprint}`,
      ].join('\n');
    })
    .join('\n\n');
}

/**
 * True when a rendered report is free of the value-bearing fields.
 *
 * Asserted by the test against a report whose `Secret` is a known string, so the
 * promise "never the matched value" is tested rather than intended.
 */
export function mentionsNoSecretField(rendered, report) {
  for (const finding of report) {
    for (const field of FORBIDDEN_FIELDS) {
      const value = finding[field];
      if (typeof value === 'string' && value.trim() !== '' && rendered.includes(value)) {
        return false;
      }
    }
  }
  return true;
}

export { FORBIDDEN_FIELDS };
