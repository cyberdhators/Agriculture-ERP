import { describe, expect, it } from 'vitest';

import { ERROR_CODES, SYNC_OUTCOMES, SYNC_OUTCOME_SPECS } from '@agri-erp/shared';

import {
  ALL_OUTCOMES_ACCOUNTED_FOR,
  classify,
  classifyFix,
  keepsFormState,
  needsSignIn,
  OUTCOMES_NOT_REACHABLE_ON_WEB,
  unsupportedFix,
} from './recovery';

/** The shape every client error class in this repository shares. */
const apiError = (status: number, code: string, message = 'Something the server said') => ({
  status,
  code,
  message,
});

describe('the authentication distinction the specification is emphatic about', () => {
  it('a 503 auth_unavailable is a RETRY, never a sign-in', () => {
    const r = classify(apiError(503, ERROR_CODES.authUnavailable));
    expect(r.outcome).toBe('retry_later');
    expect(r.action).toBe('retry');
    expect(needsSignIn(apiError(503, ERROR_CODES.authUnavailable))).toBe(false);
  });

  it('says it is not the officer’s account at fault', () => {
    expect(classify(apiError(503, ERROR_CODES.authUnavailable)).explanation).toMatch(
      /not a problem with your account/i,
    );
  });

  it('a 401 IS a sign-in, because the service answered', () => {
    const r = classify(apiError(401, ERROR_CODES.unauthenticated));
    expect(r.outcome).toBe('sign_in_again');
    expect(r.action).toBe('signin');
    expect(needsSignIn(apiError(401, ERROR_CODES.unauthenticated))).toBe(true);
  });

  it('an auth outage never throws away what the officer typed', () => {
    expect(keepsFormState(apiError(503, ERROR_CODES.authUnavailable))).toBe(true);
    expect(keepsFormState(apiError(500, ERROR_CODES.internalError))).toBe(true);
    expect(keepsFormState(apiError(422, ERROR_CODES.unprocessable))).toBe(true);
  });
});

describe('a 404 stays ambiguous, because that is the security property', () => {
  const r = classify(apiError(404, ERROR_CODES.notFound));

  it('is the caseload-safe outcome', () => {
    expect(r.outcome).toBe('left_caseload');
  });

  it('says both readings are indistinguishable, and does not choose one', () => {
    expect(r.explanation).toMatch(/no such record/i);
    expect(r.explanation).toMatch(/not on your caseload/i);
  });

  it('NEVER names another officer or confirms the record exists', () => {
    const text = `${r.title} ${r.explanation}`;
    for (const leak of ['another officer', 'owned by', 'belongs to', 'assigned to']) {
      expect(text.toLowerCase()).not.toContain(leak);
    }
  });
});

describe('a 403 is not blindly called a refusal', () => {
  const r = classify(apiError(403, ERROR_CODES.forbidden));

  it('reads as an authorisation boundary, not a record to fix', () => {
    expect(r.title).toMatch(/not something you can do/i);
    expect(r.explanation).toMatch(/supervisor or an administrator/i);
  });

  it('offers no retry, because trying again cannot help', () => {
    expect(r.action).not.toBe('retry');
  });
});

describe('conflicts and refusals keep the server’s own words', () => {
  it('a 409 shows the sentence the rule wrote', () => {
    const r = classify(apiError(409, ERROR_CODES.conflict, 'A visit with that identifier exists.'));
    expect(r.outcome).toBe('conflict');
    expect(r.explanation).toBe('A visit with that identifier exists.');
    expect(r.action).toBe('refresh');
  });

  it('a 422 shows it too — this is how correction_window_closed reaches the officer', () => {
    const sentence = 'The day for correcting this visit has passed.';
    const r = classify(apiError(422, ERROR_CODES.unprocessable, sentence));
    expect(r.outcome).toBe('refused');
    expect(r.explanation).toBe(sentence);
  });

  it('a 422 offers no retry: the same request would be refused again', () => {
    expect(classify(apiError(422, ERROR_CODES.unprocessable)).action).toBe('none');
  });

  it('a boundary refusal arrives with its own sentence, not a generic one', () => {
    const sentence = 'The boundary does not close. Walk back to the corner you started from.';
    expect(classify(apiError(422, ERROR_CODES.unprocessable, sentence)).explanation).toBe(sentence);
  });
});

describe('what is unrecognised stays retryable rather than mislabelled', () => {
  it('a 500 is a retry', () => {
    expect(classify(apiError(500, ERROR_CODES.internalError)).outcome).toBe('retry_later');
  });

  it('a network failure with no status is a retry, in neutral words', () => {
    const r = classify(new TypeError('Failed to fetch'));
    expect(r.outcome).toBe('retry_later');
    expect(r.explanation).toMatch(/try again when you have a connection/i);
  });

  it('never says the work was lost, and never announces an offline mode', () => {
    for (const failure of [new TypeError('x'), apiError(500, 'internal_error'), undefined, null]) {
      const text = `${classify(failure).title} ${classify(failure).explanation}`.toLowerCase();
      for (const alarming of ['lost', 'offline mode', 'failed permanently', 'corrupt']) {
        expect(text).not.toContain(alarming);
      }
    }
  });

  it('exposes no identifier, stack or SQL in anything it says', () => {
    const nasty = apiError(
      500,
      'internal_error',
      'at Object.<anonymous> (/app/x.ts:1:1) SELECT * FROM farmer WHERE id = 9b1f4c62-2d77-4a1e-9a3a-6f2b9c0d1e55',
    );
    const r = classify(nasty);
    // A 500's message is never shown: the fixed sentence carries no detail.
    const text = `${r.title} ${r.explanation}`;
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    expect(text).not.toMatch(/SELECT |FROM |at Object/);
  });
});

describe('the vocabulary is the project’s, and the gaps are declared', () => {
  it('uses only outcome names from the shared contract', () => {
    const outcomes = [401, 403, 404, 409, 422, 500, 503].map(
      (s) => classify(apiError(s, 'x')).outcome,
    );
    for (const outcome of outcomes) {
      expect(SYNC_OUTCOMES).toContain(outcome);
    }
  });

  it('does NOT reuse the device’s sentences, which would be false here', () => {
    // "Your records are safe on this phone and will send when it can" is true
    // of the Android queue and a lie on the web, where there is no queue.
    const web = classify(new TypeError('x')).explanation;
    expect(web).not.toBe(SYNC_OUTCOME_SPECS.retry_later.message);
    expect(web).not.toMatch(/on this phone/i);
    expect(classify(apiError(401, 'unauthenticated')).explanation).not.toMatch(/on this phone/i);
  });

  it('declares the two outcomes the web cannot reach, rather than faking them', () => {
    expect([...OUTCOMES_NOT_REACHABLE_ON_WEB]).toEqual(['waiting_for_parent', 'not_yet']);
    expect(ALL_OUTCOMES_ACCOUNTED_FOR).toBe(true);
  });

  it('every shared outcome is either reachable or declared unreachable', () => {
    const reachable = ['retry_later', 'sign_in_again', 'refused', 'left_caseload', 'conflict'];
    for (const outcome of SYNC_OUTCOMES) {
      const known =
        reachable.includes(outcome) ||
        (OUTCOMES_NOT_REACHABLE_ON_WEB as readonly string[]).includes(outcome);
      expect(known, `${outcome} is unaccounted for`).toBe(true);
    }
  });
});

describe('a GPS failure tells the officer which thing to do', () => {
  it('permission denied is its own state', () => {
    const r = classifyFix({ code: 1 });
    expect(r.problem).toBe('permission_denied');
    expect(r.explanation).toMatch(/browser settings/i);
  });

  it('position unavailable asks them to move', () => {
    const r = classifyFix({ code: 2 });
    expect(r.problem).toBe('unavailable');
    expect(r.explanation).toMatch(/move into the open/i);
  });

  it('a timeout asks them to stand still, not to move', () => {
    const r = classifyFix({ code: 3 });
    expect(r.problem).toBe('timeout');
    expect(r.explanation).toMatch(/stand still/i);
  });

  it('a device with no geolocation at all says so plainly', () => {
    expect(unsupportedFix().problem).toBe('unsupported');
  });

  it('the four are genuinely different sentences, not one message reworded', () => {
    const said = [
      classifyFix({ code: 1 }),
      classifyFix({ code: 2 }),
      classifyFix({ code: 3 }),
      unsupportedFix(),
    ];
    expect(new Set(said.map((r) => r.explanation)).size).toBe(4);
    expect(new Set(said.map((r) => r.title)).size).toBe(4);
  });

  it('none of them is a generic apology', () => {
    for (const r of [
      classifyFix({ code: 1 }),
      classifyFix({ code: 2 }),
      classifyFix({ code: 3 }),
    ]) {
      expect(r.explanation.toLowerCase()).not.toContain('something went wrong');
    }
  });
});

describe('nothing here persists, queues or detects duplicates', () => {
  it('the model holds no state at all — the same failure classifies the same way', () => {
    const once = classify(apiError(409, ERROR_CODES.conflict, 'x'));
    const twice = classify(apiError(409, ERROR_CODES.conflict, 'x'));
    expect(once).toEqual(twice);
  });
});
