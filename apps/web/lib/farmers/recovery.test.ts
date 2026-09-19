import { VERIFICATION_TRANSITIONS } from '@agri-erp/shared';
import { describe, expect, it } from 'vitest';

import { MERGE_CONSEQUENCE, MERGE_CONSTRAINT, MERGE_IRREVERSIBLE } from './recovery';

/**
 * The merge dialog was the one consequential administrator action that did not
 * say what it would do. These pin the three sentences against the contracts
 * they describe, so a later edit cannot soften them into something untrue.
 */
describe('what the merge dialog promises matches what the routes do', () => {
  it('names the same-state rule the server enforces', () => {
    // The client cannot pre-filter: no route looks a farmer up by number, so
    // the server judges the survivor first. Saying the rule beforehand is the
    // honest arrangement.
    expect(MERGE_CONSTRAINT).toMatch(/same state/i);
    expect(MERGE_CONSTRAINT).toMatch(/refused by the server/i);
  });

  it('calls the merge irreversible, which the state machine confirms', () => {
    expect(VERIFICATION_TRANSITIONS.merged).toEqual([]);
    expect(MERGE_IRREVERSIBLE).toMatch(/cannot be undone/i);
  });

  it('does not call it a deletion, because nothing is deleted', () => {
    expect(MERGE_CONSEQUENCE).toMatch(/kept/i);
    for (const word of ['delete', 'erase', 'destroy', 'permanently', 'purge']) {
      expect(MERGE_CONSEQUENCE.toLowerCase(), `merge described as ${word}`).not.toContain(word);
    }
  });

  it('states the reporting consequence C-6.8 requires', () => {
    expect(MERGE_CONSEQUENCE).toMatch(/never folded into verified/i);
  });

  it('promises no automation, no bulk and no undo', () => {
    const all = [MERGE_CONSTRAINT, MERGE_CONSEQUENCE, MERGE_IRREVERSIBLE].join(' ').toLowerCase();
    for (const invented of ['automatically', 'bulk', 'restore', 'suggested', 'score', 'severity']) {
      expect(all, `promised "${invented}"`).not.toContain(invented);
    }
  });

  it('carries no rejection note or personal data', () => {
    // The note is a sentence somebody wrote about a named person. Nothing in a
    // consequence description should ever reproduce one.
    const all = [MERGE_CONSTRAINT, MERGE_CONSEQUENCE, MERGE_IRREVERSIBLE].join(' ').toLowerCase();
    expect(all).not.toContain('note');
    expect(all).not.toContain('phone');
    expect(all).not.toContain('national id');
  });
});
