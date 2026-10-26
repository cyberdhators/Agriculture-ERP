import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SmsRateLimitedError,
  SmsUnavailableError,
  parseRateLimit,
  parseRetryAfter,
  sendOneSms,
  type SmsConfig,
} from './bird';

const CONFIG: SmsConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://eu1.platform.bird.com',
  senderId: 'AgriOne',
};

afterEach(() => vi.unstubAllGlobals());

describe('Bird rate-limit headers', () => {
  it('reads the tightest policy of a RateLimit header', () => {
    expect(parseRateLimit('"sms_send";r=12;t=30')).toEqual({ remaining: 12, resetSeconds: 30 });
    expect(parseRateLimit('"a";r=5;t=10, "b";r=0;t=4')).toEqual({ remaining: 0, resetSeconds: 4 });
    expect(parseRateLimit(null)).toBeNull();
    expect(parseRateLimit('garbage')).toBeNull();
  });

  it('reads Retry-After as seconds or a date, capped at an hour', () => {
    expect(parseRetryAfter('7')).toBe(7);
    expect(parseRetryAfter('99999')).toBe(3600);
    const now = Date.parse('2026-10-26T10:00:00Z');
    expect(parseRetryAfter('Mon, 26 Oct 2026 10:00:20 GMT', now)).toBe(20);
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('sending one SMS', () => {
  it('sends the Idempotency-Key it was given', async () => {
    const seen: Headers[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(new Headers(init.headers));
        return new Response(JSON.stringify({ id: 'sms_1' }), { status: 202 });
      }),
    );
    const r = await sendOneSms(CONFIG, '+211900000000', 'hello', { idempotencyKey: 'delivery-1' });
    expect(r).toMatchObject({ accepted: true, messageId: 'sms_1' });
    expect(seen[0]!.get('idempotency-key')).toBe('delivery-1');
  });

  it('waits out a short Retry-After once, with the same key, and does not double-send', async () => {
    const keys: (string | null)[] = [];
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        keys.push(new Headers(init.headers).get('idempotency-key'));
        calls += 1;
        return calls === 1
          ? new Response('{}', { status: 429, headers: { 'retry-after': '0' } })
          : new Response(JSON.stringify({ id: 'sms_2' }), { status: 202 });
      }),
    );
    const r = await sendOneSms(CONFIG, '+211900000000', 'hello', { idempotencyKey: 'd-2' });
    expect(r.accepted).toBe(true);
    expect(keys).toEqual(['d-2', 'd-2']);
  });

  it('a long Retry-After is reported for the batch to pause on', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '30' } })),
    );
    const failure = await sendOneSms(CONFIG, '+211900000000', 'hello').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SmsRateLimitedError);
    expect(failure).toBeInstanceOf(SmsUnavailableError);
    expect((failure as SmsRateLimitedError).retryAfterSeconds).toBe(30);
  });
});
