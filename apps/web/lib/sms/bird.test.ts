import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SMS_DEADLINE_MS,
  SmsBatchInterruptedError,
  SmsNotConfiguredError,
  SmsUnavailableError,
  sendOneSms,
  sendSmsBatch,
  smsConfig,
  smsIsConfigured,
} from './bird';

/**
 * THE BIRD CLIENT, AGAINST A FAKE `fetch`. Nothing here reaches Bird: every
 * test replaces `global.fetch` before it runs, and the configuration is a
 * placeholder built at runtime, not a credential.
 */

const NAMES = ['BIRD_API_KEY', 'BIRD_API_BASE_URL', 'BIRD_SMS_SENDER_ID'] as const;
const saved: Record<string, string | undefined> = {};
const PLACEHOLDER_KEY = ['bk', 'eu1', 'placeholder'].join('_');

function configure(over: Partial<Record<(typeof NAMES)[number], string>> = {}) {
  process.env.BIRD_API_KEY = over.BIRD_API_KEY ?? PLACEHOLDER_KEY;
  process.env.BIRD_API_BASE_URL = over.BIRD_API_BASE_URL ?? 'https://eu1.platform.bird.com/';
  process.env.BIRD_SMS_SENDER_ID = over.BIRD_SMS_SENDER_ID ?? 'CORWADO';
}

function mockFetch(...answers: Array<{ status: number; body?: unknown } | Error>) {
  const fn = vi.fn();
  for (const answer of answers) {
    if (answer instanceof Error) fn.mockRejectedValueOnce(answer);
    else
      fn.mockResolvedValueOnce({
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: () => Promise.resolve(answer.body ?? {}),
      });
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  for (const n of NAMES) saved[n] = process.env[n];
});

afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
  vi.restoreAllMocks();
});

describe('configuration', () => {
  it('names every missing setting, and never a value', () => {
    for (const n of NAMES) delete process.env[n];
    expect(() => smsConfig()).toThrow(SmsNotConfiguredError);
    try {
      smsConfig();
    } catch (failure) {
      const problems = (failure as SmsNotConfiguredError).problems.join(' ');
      for (const n of NAMES) expect(problems).toContain(n);
    }
    expect(smsIsConfigured()).toBe(false);
  });

  it('accepts a complete configuration and drops the trailing slash', () => {
    configure();
    expect(smsConfig()).toEqual({
      apiKey: PLACEHOLDER_KEY,
      baseUrl: 'https://eu1.platform.bird.com',
      senderId: 'CORWADO',
    });
  });

  it('refuses a sender that is not a 3-11 character alphanumeric sender', () => {
    for (const bad of ['+211912345678', 'AB', 'CORWADOSOUTHSUDAN', '12345']) {
      configure({ BIRD_SMS_SENDER_ID: bad });
      expect(() => smsConfig(), bad).toThrow(SmsNotConfiguredError);
    }
  });

  it('refuses a base URL that is not https', () => {
    configure({ BIRD_API_BASE_URL: 'http://eu1.platform.bird.com' });
    expect(() => smsConfig()).toThrow(SmsNotConfiguredError);
  });

  it('refuses a key whose region disagrees with the host, without sending', () => {
    configure({ BIRD_API_BASE_URL: 'https://us1.platform.bird.com' });
    const fn = mockFetch();
    expect(() => smsConfig()).toThrow(/different regions/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('never puts the key in the error', () => {
    configure({ BIRD_API_BASE_URL: 'https://us1.platform.bird.com' });
    try {
      smsConfig();
    } catch (failure) {
      expect((failure as Error).message).not.toContain(PLACEHOLDER_KEY);
    }
  });
});

describe('one message', () => {
  beforeEach(() => configure());

  it('posts to the region host with the configured sender, the service category and a deadline', async () => {
    const fn = mockFetch({ status: 202, body: { id: 'msg-1', status: 'accepted' } });
    const result = await sendOneSms(smsConfig(), '+211912345678', 'Plant after the rain.');
    expect(result).toEqual({ accepted: true, messageId: 'msg-1' });

    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://eu1.platform.bird.com/v1/sms/messages');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      to: '+211912345678',
      from: 'CORWADO',
      text: 'Plant after the rain.',
      category: 'service',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(SMS_DEADLINE_MS).toBeLessThanOrEqual(15_000);
  });

  it('counts a refusal of this message as a refusal, with Bird’s reason', async () => {
    mockFetch({ status: 422, body: { message: 'Invalid recipient' } });
    await expect(sendOneSms(smsConfig(), '+211912345678', 'x')).resolves.toEqual({
      accepted: false,
      error: 'Invalid recipient',
    });
  });

  it.each([401, 403, 429, 500, 503])('treats %i as unavailability, not a refusal', async (s) => {
    mockFetch({ status: s });
    await expect(sendOneSms(smsConfig(), '+211912345678', 'x')).rejects.toBeInstanceOf(
      SmsUnavailableError,
    );
  });

  it('treats a network failure or the deadline as unavailability', async () => {
    mockFetch(new TypeError('fetch failed'));
    await expect(sendOneSms(smsConfig(), '+211912345678', 'x')).rejects.toBeInstanceOf(
      SmsUnavailableError,
    );
    mockFetch(new DOMException('The operation timed out.', 'TimeoutError'));
    await expect(sendOneSms(smsConfig(), '+211912345678', 'x')).rejects.toBeInstanceOf(
      SmsUnavailableError,
    );
  });

  it('never reports a refusal as accepted, whatever the body says', async () => {
    mockFetch({ status: 400, body: { id: 'looks-accepted', status: 'accepted' } });
    const result = await sendOneSms(smsConfig(), '+211912345678', 'x');
    expect(result.accepted).toBe(false);
  });
});

describe('a batch', () => {
  beforeEach(() => configure());

  it('sends one request per number and counts accepted and refused', async () => {
    const fn = mockFetch(
      { status: 202, body: { id: 'a' } },
      { status: 422, body: { message: 'no' } },
      { status: 202, body: { id: 'c' } },
    );
    const numbers = ['+211911111111', '+211922222222', '+211933333333'];
    const out = await sendSmsBatch(smsConfig(), numbers, 'hello');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(out.accepted.length).toBe(2);
    expect(out.refused.length).toBe(1);
    // Each request names exactly one number: nobody sees anyone else's.
    for (const call of fn.mock.calls) {
      const sent = JSON.parse((call[1] as RequestInit).body as string) as { to: unknown };
      expect(typeof sent.to).toBe('string');
    }
  });

  it('stops starting new messages once the provider is unavailable, and reports what went out', async () => {
    const answers = [{ status: 202, body: { id: '1' } }, { status: 503 }];
    // Everything after the outage would succeed, if it were (wrongly) sent.
    for (let i = 0; i < 40; i += 1) answers.push({ status: 202, body: { id: `x${i}` } });
    const fn = mockFetch(...answers);
    const numbers = Array.from({ length: 40 }, (_, i) => `+2119${String(i).padStart(8, '0')}`);

    const failure = await sendSmsBatch(smsConfig(), numbers, 'hello').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SmsBatchInterruptedError);
    const interrupted = failure as SmsBatchInterruptedError;
    // Workers already in flight may finish; no worker starts after the outage.
    expect(fn.mock.calls.length).toBeLessThan(numbers.length);
    expect(interrupted.accepted).toBeGreaterThanOrEqual(1);
    expect(interrupted.accepted + interrupted.refused).toBe(fn.mock.calls.length - 1);
  });
});
