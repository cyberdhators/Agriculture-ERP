import { describe, expect, it } from 'vitest';

import {
  COMMUNICATION_LIMITS,
  COMMUNICATION_MESSAGES,
  communicationFarmerFilterSchema,
  sendCommunicationSchema,
  smsLength,
} from '../src/index';

/**
 * SMS LENGTH IS A COST. These pin the arithmetic the composer shows and the
 * schema enforces: GSM-7 at 160 / 153 per part, UCS-2 at 70 / 67, extension
 * characters counting twice, and a cap of three parts.
 */

const ID = '11111111-2222-4333-8444-555555555555';
const sms = (body: string) => ({
  channel: 'sms' as const,
  recipient_type: 'farmer' as const,
  recipient_ids: [ID],
  body,
});

describe('smsLength', () => {
  it('counts plain text as GSM-7, 160 in one part', () => {
    expect(smsLength('a'.repeat(160))).toEqual({
      encoding: 'gsm7',
      units: 160,
      segments: 1,
      perSegment: 160,
    });
  });

  it('splits GSM-7 at 153 per part once it is longer than one', () => {
    expect(smsLength('a'.repeat(161)).segments).toBe(2);
    expect(smsLength('a'.repeat(306)).segments).toBe(2);
    expect(smsLength('a'.repeat(307)).segments).toBe(3);
    expect(smsLength('a'.repeat(459)).segments).toBe(3);
    expect(smsLength('a'.repeat(460)).segments).toBe(4);
  });

  it('counts a GSM-7 extension character twice', () => {
    expect(smsLength('€').units).toBe(2);
    expect(smsLength('[x]').units).toBe(5);
    expect(smsLength('€'.repeat(80)).segments).toBe(1);
    expect(smsLength('€'.repeat(81)).segments).toBe(2);
  });

  it('switches to UCS-2 for Arabic script, 70 in one part and 67 after', () => {
    const arabic = 'ازرع';
    expect(smsLength(arabic).encoding).toBe('ucs2');
    expect(smsLength('ا'.repeat(70)).segments).toBe(1);
    expect(smsLength('ا'.repeat(71)).segments).toBe(2);
    expect(smsLength('ا'.repeat(201)).segments).toBe(3);
    expect(smsLength('ا'.repeat(202)).segments).toBe(4);
  });

  it('switches the whole message to UCS-2 for one curly quote', () => {
    const text = 'a'.repeat(100) + '’';
    expect(smsLength(text)).toMatchObject({ encoding: 'ucs2', units: 101, segments: 2 });
  });

  it('counts an emoji as two UCS-2 units', () => {
    expect(smsLength('🌽').units).toBe(2);
  });

  it('is zero parts for nothing', () => {
    expect(smsLength('').segments).toBe(0);
  });
});

describe('the schema caps an SMS at three parts', () => {
  it('accepts exactly three parts and refuses a fourth', () => {
    expect(COMMUNICATION_LIMITS.smsSegmentsMax).toBe(3);
    expect(sendCommunicationSchema.safeParse(sms('a'.repeat(459))).success).toBe(true);
    const parsed = sendCommunicationSchema.safeParse(sms('a'.repeat(460)));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.message)).toContain(COMMUNICATION_MESSAGES.smsTooLong);
  });

  it('applies the Unicode limit to Arabic', () => {
    expect(sendCommunicationSchema.safeParse(sms('ا'.repeat(201))).success).toBe(true);
    expect(sendCommunicationSchema.safeParse(sms('ا'.repeat(202))).success).toBe(false);
  });

  it('does not apply the SMS cap to email', () => {
    expect(
      sendCommunicationSchema.safeParse({
        channel: 'email',
        recipient_type: 'staff',
        recipient_ids: [ID],
        subject: 'Long',
        body: 'a'.repeat(2000),
      }).success,
    ).toBe(true);
  });
});

describe('the farmer picker filter', () => {
  it('accepts the filters the picker sends', () => {
    expect(
      communicationFarmerFilterSchema.safeParse({
        q: 'Deng',
        state: 'CE',
        county: 'CE-JUB',
        payam: 'CE-JUB-MUN',
        verification_status: 'verified',
        select: 'ids',
      }).success,
    ).toBe(true);
  });

  it('refuses a phone number or any field it does not know', () => {
    expect(communicationFarmerFilterSchema.safeParse({ phone: '+211912345678' }).success).toBe(
      false,
    );
  });

  it('refuses a location that is not an identifier, and an over-long search', () => {
    expect(communicationFarmerFilterSchema.safeParse({ payam: "x' OR 1=1" }).success).toBe(false);
    expect(communicationFarmerFilterSchema.safeParse({ q: 'a'.repeat(101) }).success).toBe(false);
  });
});
