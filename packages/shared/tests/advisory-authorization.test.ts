import { describe, expect, it } from 'vitest';

import {
  ADVISER_CHECKS,
  ADVISER_DECISION_RULES,
  ADVISORY_NOTE_RULES,
  adviserDecisionSchema,
  advisoryNoteInputSchema,
  advisoryNoteReviewSchema,
  effectiveAdviserStatus,
} from '../src';

describe('suspend and restore an approval (2026-10-28)', () => {
  it('suspends only a standing approval and restores only a suspension', () => {
    expect(ADVISER_DECISION_RULES.suspend).toEqual({ from: ['approved'], to: 'suspended' });
    expect(ADVISER_DECISION_RULES.restore).toEqual({ from: ['suspended'], to: 'approved' });
  });

  it('revokes from approved or suspended, and approval never comes from a suspension', () => {
    expect(ADVISER_DECISION_RULES.revoke.from).toEqual(['approved', 'suspended']);
    expect(ADVISER_DECISION_RULES.approve.from).not.toContain('suspended');
  });

  it('a suspension lapses by itself at its end', () => {
    const now = Date.now();
    expect(effectiveAdviserStatus('suspended', new Date(now + 60_000), now)).toBe('suspended');
    expect(effectiveAdviserStatus('suspended', new Date(now), now)).toBe('approved');
    expect(effectiveAdviserStatus('suspended', null, now)).toBe('approved');
    expect(effectiveAdviserStatus('revoked', new Date(now + 60_000), now)).toBe('revoked');
  });

  it('a suspension needs 1 to 365 whole days; other decisions may not carry days', () => {
    const base = { action: 'suspend', reason: 'Complaint under review' };
    expect(adviserDecisionSchema.safeParse(base).success).toBe(false);
    expect(adviserDecisionSchema.safeParse({ ...base, suspend_days: 0 }).success).toBe(false);
    expect(adviserDecisionSchema.safeParse({ ...base, suspend_days: 366 }).success).toBe(false);
    expect(adviserDecisionSchema.safeParse({ ...base, suspend_days: 1.5 }).success).toBe(false);
    expect(adviserDecisionSchema.safeParse({ ...base, suspend_days: 30 }).success).toBe(true);
    expect(
      adviserDecisionSchema.safeParse({
        action: 'restore',
        reason: 'Resolved now',
        suspend_days: 3,
      }).success,
    ).toBe(false);
  });

  it('an approval records at least one known check; nothing else carries checks', () => {
    const base = { action: 'approve', reason: 'Experience confirmed' };
    expect(adviserDecisionSchema.safeParse(base).success).toBe(false);
    expect(adviserDecisionSchema.safeParse({ ...base, checks: [] }).success).toBe(false);
    expect(adviserDecisionSchema.safeParse({ ...base, checks: ['made_up'] }).success).toBe(false);
    const ok = adviserDecisionSchema.parse({ ...base, checks: ['identity', 'identity'] });
    expect(ok.checks).toEqual(['identity']);
    expect(
      adviserDecisionSchema.safeParse({
        action: 'decline',
        reason: 'Not enough',
        checks: ['identity'],
      }).success,
    ).toBe(false);
    expect(ADVISER_CHECKS).toContain('interests_disclosed');
  });
});

describe('official advisory notes', () => {
  const note = {
    title: 'Storing sorghum after harvest',
    topics: ['post_harvest'],
    language: 'en',
    body: 'Dry the grain to below 13 percent moisture before bagging, and keep bags off the floor.',
  };

  it('needs a title, one to four known subjects, a known language and 50+ characters', () => {
    expect(advisoryNoteInputSchema.safeParse(note).success).toBe(true);
    expect(advisoryNoteInputSchema.safeParse({ ...note, topics: [] }).success).toBe(false);
    expect(
      advisoryNoteInputSchema.safeParse({
        ...note,
        topics: ['crops', 'livestock', 'post_harvest', 'other', 'climate_weather'],
      }).success,
    ).toBe(false);
    expect(advisoryNoteInputSchema.safeParse({ ...note, language: 'xx' }).success).toBe(false);
    expect(advisoryNoteInputSchema.safeParse({ ...note, body: 'too short' }).success).toBe(false);
  });

  it('publishes and returns only a submitted note; unpublishes only a published one', () => {
    expect(ADVISORY_NOTE_RULES.publish.from).toEqual(['submitted']);
    expect(ADVISORY_NOTE_RULES.return.from).toEqual(['submitted']);
    expect(ADVISORY_NOTE_RULES.unpublish.from).toEqual(['published']);
  });

  it('a return or an unpublish must say why; a publish need not', () => {
    expect(advisoryNoteReviewSchema.safeParse({ action: 'return' }).success).toBe(false);
    expect(advisoryNoteReviewSchema.safeParse({ action: 'unpublish' }).success).toBe(false);
    expect(advisoryNoteReviewSchema.safeParse({ action: 'publish' }).success).toBe(true);
    expect(
      advisoryNoteReviewSchema.safeParse({ action: 'return', note: 'Please add a source.' })
        .success,
    ).toBe(true);
  });
});
