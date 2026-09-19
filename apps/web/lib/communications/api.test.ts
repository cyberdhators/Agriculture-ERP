import { CHANNEL_RECIPIENTS, sendCommunicationSchema } from '@agri-erp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ServiceNotConnectedError, sendCommunication } from './api';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => vi.restoreAllMocks());

const ID = '11111111-2222-4333-8444-555555555555';
const valid = {
  channel: 'email' as const,
  recipient_type: 'staff' as const,
  recipient_ids: [ID],
  subject: 'Quarterly briefing',
  body: 'Please read the attached figures.',
};

describe('who each channel can actually reach', () => {
  it('email reaches staff and nobody else, because nobody else has an address', () => {
    // Not policy — data. Neither the farmer nor the officer table has an email
    // column, and an officer's `.invalid` sign-in identifier is not an address.
    expect([...CHANNEL_RECIPIENTS.email]).toEqual(['staff']);
  });

  it('SMS is the channel for farmers and officers', () => {
    expect([...CHANNEL_RECIPIENTS.sms]).toEqual(['farmer', 'officer']);
  });

  it('refuses email addressed to a farmer or an officer', () => {
    for (const recipient_type of ['farmer', 'officer'] as const) {
      const parsed = sendCommunicationSchema.safeParse({ ...valid, recipient_type });
      expect(parsed.success, `email to ${recipient_type} was accepted`).toBe(false);
    }
  });

  it('refuses SMS addressed to a staff account', () => {
    expect(
      sendCommunicationSchema.safeParse({
        channel: 'sms',
        recipient_type: 'staff',
        recipient_ids: [ID],
        body: 'hello',
      }).success,
    ).toBe(false);
  });
});

describe('what the composer may send', () => {
  it('requires at least one recipient', () => {
    expect(sendCommunicationSchema.safeParse({ ...valid, recipient_ids: [] }).success).toBe(false);
  });

  it('requires a subject on email and refuses one on SMS', () => {
    expect(sendCommunicationSchema.safeParse({ ...valid, subject: '' }).success).toBe(false);
    expect(
      sendCommunicationSchema.safeParse({
        channel: 'sms',
        recipient_type: 'farmer',
        recipient_ids: [ID],
        subject: 'not allowed',
        body: 'hello',
      }).success,
    ).toBe(false);
  });

  it('requires a message', () => {
    expect(sendCommunicationSchema.safeParse({ ...valid, body: '' }).success).toBe(false);
  });

  it('sends record ids, never addresses or phone numbers', () => {
    // The server resolves each contact itself, so a browser never carries a
    // list of people's addresses and one cannot be substituted in flight.
    const parsed = sendCommunicationSchema.parse(valid) as Record<string, unknown>;
    expect(parsed.recipient_ids).toEqual([ID]);
    for (const leaked of ['email', 'emails', 'addresses', 'phone', 'phones', 'to']) {
      expect(parsed[leaked], `the request carried ${leaked}`).toBeUndefined();
    }
  });

  it('refuses a recipient id that is not a record id', () => {
    expect(
      sendCommunicationSchema.safeParse({ ...valid, recipient_ids: ['someone@example.com'] })
        .success,
    ).toBe(false);
  });
});

describe('the service is not connected, and nothing pretends otherwise', () => {
  it('turns a missing route into an explicit not-connected error', async () => {
    mockFetch(404, {});
    await expect(sendCommunication(valid)).rejects.toBeInstanceOf(ServiceNotConnectedError);
  });

  it('never resolves successfully when the route is absent', async () => {
    // The guarantee that matters: there is no code path here that can report a
    // delivery that did not happen.
    mockFetch(404, {});
    await expect(sendCommunication(valid)).rejects.toThrow(/not connected/i);
  });

  it('reports a server refusal as a refusal, not a success', async () => {
    mockFetch(403, { error: { code: 'forbidden', message: 'Not allowed.' } });
    await expect(sendCommunication(valid)).rejects.toThrow('Not allowed.');
  });

  it('validates before it reaches the network at all', async () => {
    const fn = mockFetch(200, { data: {} });
    await expect(sendCommunication({ ...valid, body: '' })).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it('carries no provider key or secret in the request', async () => {
    const fn = mockFetch(200, { data: { id: 'c1', accepted: 1 } });
    await sendCommunication(valid).catch(() => undefined);
    const sent = JSON.stringify(fn.mock.calls[0]).toLowerCase();
    for (const secret of ['api_key', 'apikey', 'resend', 'authorization', 'bearer', 'secret']) {
      expect(sent, `the request carried ${secret}`).not.toContain(secret);
    }
  });
});
