import { describe, expect, it } from 'vitest';

import { UnresolvableRange, rangeFor } from '../scripts/ci-secret-scan-range.mjs';

/**
 * A GATE THAT CANNOT DETERMINE WHAT TO COMPARE MUST FAIL, NOT REPORT CLEAN.
 *
 * CLAUDE.md records three instances of the empty-set class; the third is the one
 * this module exists to prevent. `origin/main..HEAD` is empty on a push to main,
 * so a scan using it would have read nothing at exactly the moment a branch's
 * commits enter main -- and zero findings reads as clean.
 *
 * Tested in BOTH directions, per the standing rule: a resolver that throws on
 * everything passes every refusal test.
 */
describe('the blocking scan’s commit range', () => {
  it('reads a pull request against its base branch', () => {
    expect(rangeFor({ event: 'pull_request', baseRef: 'main' })).toBe('origin/main..HEAD');
  });

  it('reads a push from its previous tip, not from main', () => {
    // The fault this prevents: on a push to main, `origin/main..HEAD` is empty.
    expect(rangeFor({ event: 'push', beforeSha: 'aa11bb22cc33' })).toBe('aa11bb22cc33..HEAD');
  });

  it('refuses an all-zero before sha, and says which input it could not resolve', () => {
    const zeros = '0'.repeat(40);
    expect(() => rangeFor({ event: 'push', beforeSha: zeros })).toThrow(UnresolvableRange);
    try {
      rangeFor({ event: 'push', beforeSha: zeros });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('before sha');
      expect(message).toContain('all zeros');
      // It must say that nothing was scanned, not merely that it failed.
      expect(message).toContain('NOT a clean result');
    }
  });

  it('refuses an absent before sha and an absent base ref', () => {
    expect(() => rangeFor({ event: 'push', beforeSha: '' })).toThrow(UnresolvableRange);
    expect(() => rangeFor({ event: 'push' })).toThrow(UnresolvableRange);
    expect(() => rangeFor({ event: 'pull_request', baseRef: '' })).toThrow(UnresolvableRange);
    expect(() => rangeFor({ event: 'pull_request' })).toThrow(UnresolvableRange);
  });

  it('refuses an event it does not know rather than guessing a range', () => {
    expect(() => rangeFor({ event: 'schedule' })).toThrow(UnresolvableRange);
    expect(() => rangeFor({ event: 'workflow_dispatch' })).toThrow(UnresolvableRange);
  });

  it('says nothing was scanned on EVERY refusal, not only on some', () => {
    // The first version of this module said "Refusing to scan nothing" on the
    // all-zero path and omitted the not-clean sentence. A refusal that reads as
    // a mere failure invites a re-run; one that says nothing was scanned does
    // not. Every path is held to it rather than the two that had it.
    const refusals = [
      { event: 'push', beforeSha: '0'.repeat(40) },
      { event: 'push', beforeSha: '' },
      { event: 'pull_request', baseRef: '' },
      { event: 'schedule' },
    ];
    for (const input of refusals) {
      let message = '';
      try {
        rangeFor(input);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, `no refusal message for ${JSON.stringify(input)}`).not.toBe('');
      expect(
        message,
        `refusal for ${JSON.stringify(input)} omits the not-clean sentence`,
      ).toContain('NOT a clean result');
      expect(message).toContain('nothing was scanned');
    }
  });

  it('never returns an empty or open-ended range', () => {
    const resolved = [
      rangeFor({ event: 'pull_request', baseRef: 'main' }),
      rangeFor({ event: 'push', beforeSha: 'aa11bb22cc33' }),
    ];
    for (const range of resolved) {
      expect(range).toMatch(/\.\.HEAD$/);
      expect(range.startsWith('..')).toBe(false);
    }
  });
});
