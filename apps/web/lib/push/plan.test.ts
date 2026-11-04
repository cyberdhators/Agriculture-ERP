import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { accountChannel, isPushEndpoint, pushSubscriptionSchema } from '@agri-erp/shared';

import type { RealtimeEvent } from '../realtime/publish';
import { alertsFor, intentsFrom, type Subscriber } from './plan';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CONVERSATION = '33333333-3333-4333-8333-333333333333';
const NOTICE = '44444444-4444-4444-8444-444444444444';

const phone = (over: Partial<Subscriber> = {}): Subscriber => ({
  id: 'p1',
  auth_user_id: A,
  endpoint: 'https://fcm.googleapis.com/fcm/send/one',
  p256dh: 'k',
  auth: 'a',
  language: 'en',
  side: 'farmer',
  updates_on: true,
  ...over,
});

const message: RealtimeEvent = {
  event: 'message.created',
  channels: [accountChannel(A), accountChannel(B)],
  data: { conversation_id: CONVERSATION, message_id: NOTICE, sender: B },
};

const firstNotice: RealtimeEvent = {
  event: 'notification.created',
  channels: [accountChannel(A)],
  data: {
    notification_id: NOTICE,
    kind: 'update',
    notice: 'message_listing',
    ref_kind: 'conversation',
    ref_id: CONVERSATION,
  },
};

describe('who gets a phone alert', () => {
  it('never alerts the writer of a message', () => {
    const [intent] = intentsFrom([message], []);
    const alerts = alertsFor(intent!, [phone(), phone({ auth_user_id: B, id: 'p2' })], new Set());
    expect(alerts.map((a) => a.subscriber.auth_user_id)).toEqual([A]);
  });

  it('respects "activity updates" switched off, for messages', () => {
    const [intent] = intentsFrom([message], []);
    expect(alertsFor(intent!, [phone({ updates_on: false })], new Set())).toEqual([]);
  });

  it("a conversation's first message is one alert, not two, and opens the conversation", () => {
    const seen = new Set<string>();
    const alerts = intentsFrom([message, firstNotice], []).flatMap((i) =>
      alertsFor(i, [phone()], seen),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload.href).toBe(`/farmer/account/messages?c=${CONVERSATION}`);
  });

  it("opens the buyer's own messages on the buyer's phone", () => {
    const [intent] = intentsFrom([message], []);
    const [alert] = alertsFor(intent!, [phone({ side: 'buyer' })], new Set());
    expect(alert!.payload.href).toBe(`/buyer/messages?c=${CONVERSATION}`);
  });

  it('ignores a notice name it does not know', () => {
    const unknown: RealtimeEvent = {
      event: 'notification.created',
      channels: [accountChannel(A)],
      data: { notification_id: NOTICE, kind: 'announcement', notice: 'announcement' },
    };
    expect(intentsFrom([unknown], [])).toEqual([]);
  });
});

describe('what a phone alert says', () => {
  it("is in the phone's language", () => {
    const [intent] = intentsFrom([message], []);
    const [alert] = alertsFor(intent!, [phone({ language: 'ar' })], new Set());
    expect(alert!.payload.title).toMatch(/[؀-ۿ]/);
    expect(alert!.payload.lang).toBe('ar');
  });

  it('carries fixed wording only: nothing an event or a note could smuggle', () => {
    const smuggled = {
      ...message,
      data: { ...message.data, body: 'PRIVATE', title: 'PRIVATE', text: 'PRIVATE' },
    } as unknown as RealtimeEvent;
    const [intent] = intentsFrom([smuggled], []);
    const [alert] = alertsFor(intent!, [phone()], new Set());
    expect(JSON.stringify(alert!.payload)).not.toContain('PRIVATE');
  });

  it('the sender reads no stored notice or message text', () => {
    const source = readFileSync(fileURLToPath(new URL('./send.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/public\.(notification|message)\b/);
  });
});

describe('the address a phone hands over', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://web.push.apple.com/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('accepts %s', (url) => {
    expect(isPushEndpoint(url)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com.example.org/abc',
    'https://fcm.googleapis.com:8443/abc',
    'https://user:pw@fcm.googleapis.com/abc',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/abc',
    'https://notpush.apple.com/abc',
    'not a url',
  ])('refuses %s', (url) => {
    expect(isPushEndpoint(url)).toBe(false);
  });

  it('refuses an unknown field or language', () => {
    const body = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'abc', auth: 'def' },
      language: 'en',
    };
    expect(pushSubscriptionSchema.safeParse(body).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ ...body, language: 'fr' }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ ...body, owner: 'x' }).success).toBe(false);
  });
});
