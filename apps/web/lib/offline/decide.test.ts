import { describe, expect, it } from 'vitest';

import { SYNC_OUTCOME_SPECS } from '@agri-erp/shared';

import { backoffMs, decideAnswer, decideNoAnswer, parseRetryAfter, reasonFor } from './decide';

const NOW = 1_000_000;

describe('the outbox decides from the server answer (C-9)', () => {
  it('a 2xx is acknowledged: the phone may forget the record', () => {
    expect(decideAnswer({ status: 200, attempts: 0, now: NOW })).toEqual({ kind: 'acked' });
    expect(decideAnswer({ status: 201, attempts: 3, now: NOW })).toEqual({ kind: 'acked' });
  });

  it('no answer at all retries later, never drops', () => {
    const d = decideNoAnswer(0, NOW);
    expect(d.kind).toBe('retry');
    if (d.kind === 'retry') expect(d.at).toBe(NOW + backoffMs(0));
  });

  it('a 5xx retries, honouring Retry-After when it is longer', () => {
    const d = decideAnswer({ status: 503, retryAfter: '600', attempts: 0, now: NOW });
    expect(d).toMatchObject({ kind: 'retry', outcome: 'retry_later', at: NOW + 600_000 });
  });

  it('a 401 asks the person to sign in again and keeps the record', () => {
    expect(decideAnswer({ status: 401, attempts: 0, now: NOW })).toEqual({
      kind: 'reauth',
      outcome: 'sign_in_again',
    });
  });

  it('refusals, conflicts and lost access stop and wait for the person', () => {
    expect(decideAnswer({ status: 422, attempts: 0, now: NOW })).toEqual({
      kind: 'stop',
      outcome: 'refused',
    });
    expect(decideAnswer({ status: 400, attempts: 0, now: NOW })).toEqual({
      kind: 'stop',
      outcome: 'refused',
    });
    expect(decideAnswer({ status: 409, attempts: 0, now: NOW })).toEqual({
      kind: 'stop',
      outcome: 'conflict',
    });
    expect(decideAnswer({ status: 404, attempts: 0, now: NOW })).toEqual({
      kind: 'stop',
      outcome: 'left_caseload',
    });
  });

  it('an attachment still arriving is retried shortly, not refused', () => {
    const d = decideAnswer({ status: 409, code: 'attachment_not_arrived', attempts: 0, now: NOW });
    expect(d).toMatchObject({ kind: 'retry', outcome: 'not_yet' });
  });

  it('an answer the contract does not name stops rather than loops (e.g. 403)', () => {
    expect(decideAnswer({ status: 403, attempts: 0, now: NOW })).toEqual({
      kind: 'stop',
      outcome: 'unexpected',
    });
  });

  it('waits grow with each try and are capped at 30 minutes', () => {
    expect(backoffMs(0)).toBe(15_000);
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(20)).toBe(30 * 60_000);
  });

  it('reads Retry-After as seconds or as a date', () => {
    expect(parseRetryAfter('60', NOW)).toBe(60_000);
    expect(parseRetryAfter(new Date(NOW + 5_000).toUTCString(), NOW)).toBeGreaterThan(0);
    expect(parseRetryAfter('nonsense', NOW)).toBeNull();
    expect(parseRetryAfter(null, NOW)).toBeNull();
  });

  it('a refused record shows the server reason; others show the contract sentence', () => {
    expect(
      reasonFor('refused', 'Some products cannot be requested.', {
        'items.0.quantity': 'Too much.',
      }),
    ).toBe('Some products cannot be requested. Too much.');
    expect(reasonFor('conflict')).toBe(SYNC_OUTCOME_SPECS.conflict.message);
    expect(reasonFor('left_caseload')).toBe(SYNC_OUTCOME_SPECS.left_caseload.message);
  });
});
