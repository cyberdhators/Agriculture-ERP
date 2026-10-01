import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * EVERY ACCOUNTED-FOR FINDING CARRIES A WRITTEN REASON.
 *
 * `.gitleaksignore` is where a secret-scan finding stops being a failure and
 * becomes a decision. CLAUDE.md's Secrets law says the scan has no allowlist and
 * a false positive is the owner's deliberate decision -- so an entry without a
 * reason is not a decision, it is a silencing, and it is indistinguishable from
 * one six months later.
 *
 * THE PATH IS RESOLVED FROM THIS FILE, NOT FROM THE WORKING DIRECTORY. A gate
 * that resolves its own subject relative to the caller's cwd reads every file as
 * absent from anywhere else and passes by comparing nothing -- that happened to
 * the migration-checksum gate in this repository and is recorded in CLAUDE.md as
 * an instance of the empty-set class. Hence `import.meta.url`.
 */
const path = fileURLToPath(new URL('../.gitleaksignore', import.meta.url));

interface Entry {
  readonly fingerprint: string;
  readonly lineNumber: number;
  readonly reason: string | null;
}

/** Entries, each paired with the comment line immediately above it. */
function parse(contents: string): Entry[] {
  const lines = contents.split('\n');
  const entries: Entry[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim();
    if (line === '' || line.startsWith('#')) continue;

    // Walk back past blank lines to the nearest non-blank line.
    let above = index - 1;
    while (above >= 0 && (lines[above] ?? '').trim() === '') above -= 1;
    const previous = above >= 0 ? (lines[above] ?? '').trim() : '';
    const reason = previous.startsWith('#') ? previous.replace(/^#+/, '').trim() : null;

    entries.push({
      fingerprint: line,
      lineNumber: index + 1,
      reason: reason === '' ? null : reason,
    });
  }

  return entries;
}

describe('.gitleaksignore', () => {
  it('exists — the convention and its test ship together', () => {
    expect(existsSync(path)).toBe(true);
  });

  it('documents the reason-above-the-entry convention', () => {
    const contents = readFileSync(path, 'utf8');
    expect(contents).toContain('THE REASON GOES ON THE LINE ABOVE THE FINGERPRINT');
  });

  it('gives every entry a non-empty reason on the line above it', () => {
    const entries = parse(readFileSync(path, 'utf8'));
    const unexplained = entries.filter((entry) => entry.reason === null);

    // Named, not counted: a refusal that does not name its subject cannot be
    // acted on. The fingerprint carries no secret value, so printing it is safe.
    const message = unexplained
      .map((entry) => `  line ${entry.lineNumber}: ${entry.fingerprint}`)
      .join('\n');

    expect(
      unexplained.length,
      unexplained.length === 0
        ? ''
        : `These .gitleaksignore entries have no reason on the line above them:\n${message}\n\n` +
            'Write one sentence above each saying why the finding is accounted for. ' +
            'An entry without a reason is a silencing, not a decision.',
    ).toBe(0);
  });

  it('parses a reason, and refuses one that is only a hash mark', () => {
    // Both directions: a guard that accepts everything passes every acceptance
    // test, and a guard that refuses everything passes every refusal test.
    const good = parse('# because the credential is rotated and burned\nabc123:f.mjs:rule:1\n');
    expect(good).toHaveLength(1);
    expect(good[0]?.reason).toBe('because the credential is rotated and burned');

    expect(parse('#\nabc123:f.mjs:rule:1\n')[0]?.reason).toBeNull();
    expect(parse('abc123:f.mjs:rule:1\n')[0]?.reason).toBeNull();
    expect(parse('# a reason\n\n\nabc123:f.mjs:rule:1\n')[0]?.reason).toBe('a reason');
  });

  it('is empty of entries until the audit has actually run', () => {
    // Removable the moment a real finding is accounted for. Until then it
    // records that no finding has been decided about rather than that none
    // exists -- ABSENT is not ZERO.
    expect(parse(readFileSync(path, 'utf8'))).toHaveLength(0);
  });
});
