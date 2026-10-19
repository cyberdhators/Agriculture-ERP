import { describe, expect, it } from 'vitest';

import {
  MESSAGE_MAX_LENGTH,
  MESSAGING_MESSAGES,
  sendMessageSchema,
  shortName,
  startConversationSchema,
} from '../src';

const ID = '7a1b2c3d-0000-4000-8000-000000000001';

describe('how a person is named to the other side', () => {
  it('is the given name and an initial, never the full family name', () => {
    expect(shortName('Mary', 'Kuol')).toBe('Mary K.');
    expect(shortName(' Deng ', ' akol ')).toBe('Deng A.');
    expect(shortName('Achol', '')).toBe('Achol');
  });
});

describe('a message', () => {
  it('is trimmed, and a blank one is refused in our own words', () => {
    expect(sendMessageSchema.parse({ id: ID, body: '  Hello  ' }).body).toBe('Hello');
    const blank = sendMessageSchema.safeParse({ id: ID, body: '   ' });
    expect(blank.success).toBe(false);
    expect(blank.error?.issues[0]?.message).toBe(MESSAGING_MESSAGES.bodyRequired);
  });

  it('has a length limit the database also holds', () => {
    expect(
      sendMessageSchema.safeParse({ id: ID, body: 'a'.repeat(MESSAGE_MAX_LENGTH) }).success,
    ).toBe(true);
    const long = sendMessageSchema.safeParse({ id: ID, body: 'a'.repeat(MESSAGE_MAX_LENGTH + 1) });
    expect(long.error?.issues[0]?.message).toBe(MESSAGING_MESSAGES.bodyTooLong);
  });

  it('carries an id made on the phone, so a resend is the same message', () => {
    expect(sendMessageSchema.safeParse({ body: 'Hello' }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ id: 'not-an-id', body: 'Hello' }).success).toBe(false);
  });

  it('accepts nothing it does not know', () => {
    expect(sendMessageSchema.safeParse({ id: ID, body: 'Hi', to: ID }).success).toBe(false);
  });
});

describe('starting a conversation', () => {
  it('is always about a post of a known kind', () => {
    const base = { post_id: ID, message_id: ID, body: 'Is it still available?' };
    for (const kind of ['listing', 'buying_request', 'service']) {
      expect(startConversationSchema.safeParse({ ...base, post_kind: kind }).success).toBe(true);
    }
    const person = startConversationSchema.safeParse({ ...base, post_kind: 'person' });
    expect(person.error?.issues[0]?.message).toBe(MESSAGING_MESSAGES.postKindUnknown);
  });
});
