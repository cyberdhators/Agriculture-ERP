import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  WEBHOOK_TOLERANCE_SECONDS,
  isStopReply,
  parseSmsEvent,
  receiptDelivered,
  signWebhook,
  smsEventAction,
  verifyWebhook,
} from './bird-webhook';

/**
 * The signing secret is made here, at random, for this run only: no real
 * secret is in this file, and nothing here could verify a real delivery.
 */
const secret = () => `whsec_${randomBytes(24).toString('base64')}`;
const NOW = 1_800_000_000;
const BODY = JSON.stringify({ type: 'sms.delivered', timestamp: '2026-10-26T10:00:00Z', data: {} });

describe('Standard Webhooks signature', () => {
  it('accepts a delivery signed with the secret, fresh', () => {
    const s = secret();
    const ts = String(NOW);
    const signature = signWebhook(s, 'msg_1', ts, BODY);
    expect(verifyWebhook(s, { id: 'msg_1', timestamp: ts, signature }, BODY, NOW)).toEqual({
      ok: true,
    });
  });

  it('refuses another secret, another body, another id', () => {
    const s = secret();
    const ts = String(NOW);
    const signature = signWebhook(s, 'msg_1', ts, BODY);
    expect(verifyWebhook(secret(), { id: 'msg_1', timestamp: ts, signature }, BODY, NOW).ok).toBe(
      false,
    );
    expect(
      verifyWebhook(s, { id: 'msg_1', timestamp: ts, signature }, `${BODY} `, NOW).ok,
    ).toBe(false);
    expect(verifyWebhook(s, { id: 'msg_2', timestamp: ts, signature }, BODY, NOW).ok).toBe(false);
  });

  it('refuses a stale or future delivery (a replayed capture)', () => {
    const s = secret();
    const old = String(NOW - WEBHOOK_TOLERANCE_SECONDS - 1);
    const signature = signWebhook(s, 'msg_1', old, BODY);
    expect(verifyWebhook(s, { id: 'msg_1', timestamp: old, signature }, BODY, NOW)).toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('accepts any one of several signatures (secret rotation)', () => {
    const s = secret();
    const ts = String(NOW);
    const good = signWebhook(s, 'msg_1', ts, BODY);
    const signature = `v1,AAAA ${good}`;
    expect(verifyWebhook(s, { id: 'msg_1', timestamp: ts, signature }, BODY, NOW).ok).toBe(true);
  });

  it('refuses missing headers and a malformed secret', () => {
    expect(verifyWebhook(secret(), { id: null, timestamp: '1', signature: 'v1,x' }, BODY).ok).toBe(
      false,
    );
    expect(
      verifyWebhook('not-a-secret!', { id: 'a', timestamp: String(NOW), signature: 'v1,x' }, BODY, NOW),
    ).toEqual({ ok: false, reason: 'bad_secret' });
  });
});

describe('what each event asks', () => {
  it('maps the five receipts', () => {
    expect(smsEventAction('sms.delivered')).toEqual({ kind: 'receipt', status: 'delivered' });
    expect(smsEventAction('sms.undelivered')).toEqual({ kind: 'receipt', status: 'undelivered' });
    expect(smsEventAction('sms.failed')).toEqual({ kind: 'receipt', status: 'failed' });
    expect(smsEventAction('sms.rejected')).toEqual({ kind: 'receipt', status: 'rejected' });
    expect(smsEventAction('sms.expired')).toEqual({ kind: 'receipt', status: 'expired' });
    expect(receiptDelivered('delivered')).toBe(true);
    expect(receiptDelivered('expired')).toBe(false);
  });

  it('inbound, suppressions, and anything new is ignored', () => {
    expect(smsEventAction('sms.received')).toEqual({ kind: 'received' });
    expect(smsEventAction('sms_suppression.created')).toEqual({ kind: 'suppression' });
    expect(smsEventAction('sms.accepted')).toEqual({ kind: 'ignore' });
    expect(smsEventAction('something.new')).toEqual({ kind: 'ignore' });
  });

  it('a stop reply is only the word, in English or Arabic', () => {
    expect(isStopReply(' STOP ')).toBe(true);
    expect(isStopReply('stop.')).toBe(true);
    expect(isStopReply('توقف')).toBe(true);
    expect(isStopReply('please stop sending prices')).toBe(false);
    expect(isStopReply('')).toBe(false);
  });

  it('reads the fields it uses and keeps the number only to match', () => {
    const e = parseSmsEvent({
      type: 'sms.undelivered',
      timestamp: '2026-10-26T10:00:00Z',
      data: { sms_id: 'sms_1', to: '+211900000000', error: { code: 'unreachable' } },
    });
    expect(e).toMatchObject({ smsId: 'sms_1', errorCode: 'unreachable', phone: null, text: null });
    const s = parseSmsEvent({
      type: 'sms_suppression.created',
      timestamp: '2026-10-26T10:00:00Z',
      data: { suppression_id: 'ssu_1', destination: '+211900000000', reason: 'keyword_stop' },
    });
    expect(s).toMatchObject({ suppressionId: 'ssu_1', phone: '+211900000000' });
    expect(parseSmsEvent(null)).toBeNull();
    expect(parseSmsEvent({ data: {} })).toBeNull();
  });
});
