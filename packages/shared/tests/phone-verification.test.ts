import { describe, expect, it } from 'vitest';

import {
  PHONE_CODE,
  PHONE_CODE_MESSAGES,
  farmerSelfRegisterSchema,
  phoneCodeRequestSchema,
  phoneCodeVerifySchema,
} from '../src/index';

const id = '7b0e8a52-0f3c-4c8e-9a51-2d6f4b1c9e10';

describe('phone verification by SMS code (2026-10-19)', () => {
  it('sends codes only to South Sudan mobiles, normalised', () => {
    expect(phoneCodeRequestSchema.parse({ phone: '0912345678' }).phone).toBe('+211912345678');
    expect(phoneCodeRequestSchema.safeParse({ phone: '+254712345678' }).success).toBe(false);
  });

  it('takes exactly six digits', () => {
    expect(phoneCodeVerifySchema.safeParse({ verification_id: id, code: ' 012345 ' }).success).toBe(
      true,
    );
    for (const code of ['12345', '1234567', '12a456', '']) {
      const r = phoneCodeVerifySchema.safeParse({ verification_id: id, code });
      expect(r.error?.issues[0]?.message, code).toBe(PHONE_CODE_MESSAGES.codeShape);
    }
    expect(phoneCodeVerifySchema.safeParse({ verification_id: 'x', code: '123456' }).success).toBe(
      false,
    );
  });

  it('keeps the limits the owner accepted', () => {
    expect(PHONE_CODE).toMatchObject({ length: 6, ttlMinutes: 10, maxAttempts: 5 });
  });

  it('sign-up carries the verification id when there is one', () => {
    const base = farmerSelfRegisterSchema.safeParse({ verification_id: 'not-a-uuid' });
    expect(base.success).toBe(false);
    expect(
      base.error?.issues.some((i) => String(i.path[0]) === 'verification_id'),
      'a malformed verification id is refused by name',
    ).toBe(true);
  });
});
