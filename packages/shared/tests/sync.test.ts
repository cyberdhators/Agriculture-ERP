import { describe, expect, it } from 'vitest';
import { SYNC_OUTCOMES, SYNC_OUTCOME_SPECS, deviceIdSchema, syncOutcomeFor } from '../src/sync';

/** C-9.4, C-9.15: the seven outcomes, and how the six the server produces are read. */
describe('the sync outcomes', () => {
  it('every outcome has an action and a sentence; the retryable ones say when', () => {
    for (const code of SYNC_OUTCOMES) {
      const spec = SYNC_OUTCOME_SPECS[code];
      expect(spec.message.length).toBeGreaterThan(10);
      if (spec.action === 'retry') expect(spec.retryAfterSeconds).toBeGreaterThan(0);
      else expect(spec.retryAfterSeconds).toBeUndefined();
    }
  });
  it('maps the statuses the routes produce; waiting_for_parent is never a server response', () => {
    expect(syncOutcomeFor(401)).toBe('sign_in_again');
    expect(syncOutcomeFor(503)).toBe('retry_later');
    expect(syncOutcomeFor(500)).toBe('retry_later');
    expect(syncOutcomeFor(409, 'attachment_not_arrived')).toBe('not_yet');
    expect(syncOutcomeFor(409, 'farmer_already_exists')).toBe('conflict');
    expect(syncOutcomeFor(404)).toBe('left_caseload');
    for (const s of [400, 413, 422]) expect(syncOutcomeFor(s)).toBe('refused');
    expect(syncOutcomeFor(200)).toBeNull();
    expect(SYNC_OUTCOMES.map((c) => syncOutcomeFor(0, c))).not.toContain('waiting_for_parent');
  });
  it('a device identifier is opaque, bounded, and never a phrase', () => {
    expect(deviceIdSchema.safeParse('a1b2c3d4-install').success).toBe(true);
    expect(deviceIdSchema.safeParse('short').success).toBe(false);
    expect(deviceIdSchema.safeParse('has spaces in it').success).toBe(false);
    expect(deviceIdSchema.safeParse('x'.repeat(65)).success).toBe(false);
  });
});
