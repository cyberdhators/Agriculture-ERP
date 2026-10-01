import { describe, expect, it } from 'vitest';

import {
  FORBIDDEN_FIELDS,
  formatFindings,
  locationOf,
  mentionsNoSecretField,
} from '../scripts/ci-secret-findings.mjs';

/**
 * THE REFUSAL NAMES ITS SUBJECT, AND NEVER THE VALUE.
 *
 * The scan this replaces printed `leaks found: 1` and nothing else, so a real
 * committed password sat behind that line while every branch went red for it and
 * the gate could not say which file to open.
 *
 * The opposite failure is worse: printing the finding's own `Secret`, `Match` or
 * `Line` would publish the credential into a CI log readable by anyone who can
 * see the run. The report is parsed in the step and discarded, never uploaded as
 * an artifact, and these tests hold the rendering to that.
 */
const REPORT = [
  {
    RuleID: 'generic-api-key',
    File: 'scripts/officer-test-fixture.mjs',
    StartLine: 34,
    EndLine: 34,
    Commit: 'f2d6003',
    Fingerprint: 'f2d6003:scripts/officer-test-fixture.mjs:generic-api-key:34',
    // NOT CREDENTIAL-SHAPED, DELIBERATELY. The first version of this fixture
    // wrote `const PASSWORD = '...'` to look like the real finding it describes
    // -- and that is the shape gitleaks' own generic-api-key rule hunts, so this
    // test would have become a finding in the gate it tests. The lesson is
    // recorded in docs/PROJECT-STATE.md: the instrument that checks a class of
    // fault is written in the same idiom as the fault. Sentinels carry no shape.
    Secret: 'the-value-this-test-must-never-print',
    Match: 'a source line that contained the value above',
    Line: 'a source line that contained the value above',
  },
];

describe('rendering a secret-scan finding', () => {
  it('names rule, file, line, commit and fingerprint', () => {
    const rendered = formatFindings(REPORT);
    expect(rendered).toContain('generic-api-key');
    expect(rendered).toContain('scripts/officer-test-fixture.mjs');
    expect(rendered).toContain('34');
    expect(rendered).toContain('f2d6003');
    expect(rendered).toContain('f2d6003:scripts/officer-test-fixture.mjs:generic-api-key:34');
  });

  it('never emits the matched value, the match, or the source line', () => {
    const rendered = formatFindings(REPORT);
    for (const field of FORBIDDEN_FIELDS) {
      const value = REPORT[0]?.[field as keyof (typeof REPORT)[0]];
      expect(rendered).not.toContain(String(value));
    }
    expect(mentionsNoSecretField(rendered, REPORT)).toBe(true);
  });

  it('would catch a rendering that did leak the value — the check can fail', () => {
    // A guard that cannot fail is the fault class this repository has recorded
    // five ways. This proves `mentionsNoSecretField` is capable of saying no.
    expect(mentionsNoSecretField(`leaked ${REPORT[0]?.Secret}`, REPORT)).toBe(false);
  });

  it('keeps named fields rather than dropping known-bad ones', () => {
    // A denylist over report fields would let a future gitleaks field carrying
    // the value pass straight through. locationOf names what it keeps.
    const first = REPORT[0];
    if (first === undefined) throw new Error('the fixture report is empty');
    const location = locationOf(first);
    expect(Object.keys(location).sort()).toEqual(
      ['commit', 'endLine', 'file', 'fingerprint', 'rule', 'startLine'].sort(),
    );
  });

  it('says so plainly when a report is empty, rather than printing nothing', () => {
    expect(formatFindings([])).toBe('No findings.');
  });

  it('survives a report missing fields, without inventing a location', () => {
    const rendered = formatFindings([{ RuleID: 'x' }]);
    expect(rendered).toContain('(no file in report)');
    expect(rendered).toContain('(working tree)');
  });
});
