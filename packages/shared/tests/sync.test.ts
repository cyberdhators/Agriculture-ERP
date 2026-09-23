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
    // NOTE: these two pass the key as the CODE, which the server never sends.
    // They are kept because the argument is still accepted, but the real path
    // is the rule -- proved in "the rule is what reaches the device" below.
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

/**
 * THE RULE IS WHAT REACHES THE DEVICE.
 *
 * `syncOutcomeFor` used to read `code === 'attachment_not_arrived'`, and a 409's
 * code is always the generic `conflict` -- the rule key never left the server.
 * The branch could not fire, so `not_yet` was unreachable and a phone would
 * have stopped retrying an attachment whose bytes were still on their way.
 *
 * The test that covered it passed anyway, because it fed the key in as the
 * code: a value the server cannot produce. These use the shape the server
 * actually sends.
 */
describe('a 409 is classified by its rule, as the server sends it', () => {
  const asSent = { status: 409, code: 'conflict' };

  it('attachment_not_arrived is NOT_YET — retry soon, do not give up', () => {
    expect(syncOutcomeFor(asSent.status, asSent.code, 'attachment_not_arrived')).toBe('not_yet');
    expect(SYNC_OUTCOME_SPECS.not_yet.action).toBe('retry');
    expect(SYNC_OUTCOME_SPECS.not_yet.retryAfterSeconds).toBe(10);
  });

  it('every other 409 stays CONFLICT — terminal, do not retry', () => {
    for (const rule of [
      'farmer_already_exists',
      'visit_already_exists',
      'boundary_already_exists',
      'farm_already_exists',
      'boundary_recorded_concurrently',
    ]) {
      expect(syncOutcomeFor(409, 'conflict', rule), rule).toBe('conflict');
    }
    expect(SYNC_OUTCOME_SPECS.conflict.action).toBe('stop');
  });

  it('a 409 with no rule at all is still a conflict — the safe reading', () => {
    expect(syncOutcomeFor(409, 'conflict')).toBe('conflict');
    expect(syncOutcomeFor(409)).toBe('conflict');
  });

  it('the rule never promotes a non-409 into not_yet', () => {
    expect(syncOutcomeFor(422, 'unprocessable', 'attachment_not_arrived')).toBe('refused');
    expect(syncOutcomeFor(404, 'not_found', 'attachment_not_arrived')).toBe('left_caseload');
    expect(syncOutcomeFor(500, 'internal_error', 'attachment_not_arrived')).toBe('retry_later');
  });
});

describe('a 422 keeps its refusal classification whatever the rule says', () => {
  it.each([
    'correction_window_closed',
    'follow_up_cycle',
    'boundary_not_closed',
    'boundary_too_few_points',
    'consent_required',
  ])('%s -> refused', (rule) => {
    expect(syncOutcomeFor(422, 'unprocessable', rule)).toBe('refused');
  });

  it("refused is terminal and shows the rule's own sentence", () => {
    expect(SYNC_OUTCOME_SPECS.refused.action).toBe('stop');
    expect(SYNC_OUTCOME_SPECS.refused.retryAfterSeconds).toBeUndefined();
  });
});

describe('older callers are unaffected', () => {
  it('two-argument calls classify exactly as they did', () => {
    expect(syncOutcomeFor(401)).toBe('sign_in_again');
    expect(syncOutcomeFor(503)).toBe('retry_later');
    expect(syncOutcomeFor(404)).toBe('left_caseload');
    expect(syncOutcomeFor(422)).toBe('refused');
    expect(syncOutcomeFor(200)).toBeNull();
  });

  it('no new outcome was invented', () => {
    const produced = [
      syncOutcomeFor(409, 'conflict', 'attachment_not_arrived'),
      syncOutcomeFor(409, 'conflict', 'farmer_already_exists'),
      syncOutcomeFor(422, 'unprocessable', 'consent_required'),
    ];
    for (const outcome of produced) expect(SYNC_OUTCOMES).toContain(outcome);
  });
});
