import { describe, expect, it } from 'vitest';

import {
  RULE_MESSAGES,
  authUnavailable,
  conflict,
  forbidden,
  internalError,
  notFound,
  unauthenticated,
  unprocessable,
  type RuleKey,
} from './errors';

/**
 * THE RULE KEY ON THE WIRE.
 *
 * `conflict(rule)` and `unprocessable(rule)` put the rule's SENTENCE in
 * `message` and left the key on the server, so a device could not tell one
 * refusal from another and `not_yet` was unreachable. The key now travels in
 * the body beside an unchanged `code`.
 *
 * These assert the BODY the route actually serialises, not the helper's shape.
 */
describe('a conflict carries its rule without changing anything else', () => {
  const failure = conflict('attachment_not_arrived');
  const body = failure.body();

  it('is still 409 with the generic code', () => {
    expect(failure.status).toBe(409);
    expect(body.error.code).toBe('conflict');
  });

  it('names the rule', () => {
    expect(body.error.rule).toBe('attachment_not_arrived');
  });

  it('keeps the rule’s own sentence, word for word', () => {
    expect(body.error.message).toBe(RULE_MESSAGES.attachment_not_arrived);
  });

  it('still carries Retry-After, and only for this one rule', () => {
    expect(failure.headers?.['retry-after']).toBe('10');
    expect(conflict('farmer_already_exists').headers).toBeUndefined();
  });
});

describe('an unprocessable carries its rule too', () => {
  it.each<RuleKey>(['correction_window_closed', 'consent_required', 'boundary_not_closed'])(
    '%s survives in the body with its sentence intact',
    (rule) => {
      const failure = unprocessable(rule);
      const body = failure.body();
      expect(failure.status).toBe(422);
      expect(body.error.code).toBe('unprocessable');
      expect(body.error.rule).toBe(rule);
      expect(body.error.message).toBe(RULE_MESSAGES[rule]);
    },
  );

  it('carries no Retry-After: a refusal will not succeed on retry', () => {
    expect(unprocessable('consent_required').headers).toBeUndefined();
  });
});

describe('every rule the registry defines reaches the wire', () => {
  it('conflict and unprocessable both emit the key for all of them', () => {
    for (const rule of Object.keys(RULE_MESSAGES) as RuleKey[]) {
      expect(conflict(rule).body().error.rule, rule).toBe(rule);
      expect(unprocessable(rule).body().error.rule, rule).toBe(rule);
    }
  });

  it('a rule is only ever a published key — never free text or internals', () => {
    for (const rule of Object.keys(RULE_MESSAGES) as RuleKey[]) {
      expect(rule).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(rule).not.toMatch(/select |from |error:|\/|\\|\./i);
    }
  });
});

describe('errors that name no rule are unchanged', () => {
  it('omits the key entirely rather than sending null or empty', () => {
    for (const failure of [
      unauthenticated(),
      forbidden(),
      notFound(),
      internalError(),
      authUnavailable(),
    ]) {
      const body = failure.body();
      expect('rule' in body.error, `${body.error.code} gained a rule`).toBe(false);
    }
  });

  it('their statuses and codes are exactly as before', () => {
    expect([unauthenticated().status, forbidden().status, notFound().status]).toEqual([
      401, 403, 404,
    ]);
    expect([internalError().status, authUnavailable().status]).toEqual([500, 503]);
  });

  it('the two retryable ones keep their Retry-After', () => {
    expect(internalError().headers?.['retry-after']).toBe('60');
    expect(authUnavailable().headers?.['retry-after']).toBe('60');
  });
});
