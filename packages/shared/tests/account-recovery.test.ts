import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_RECOVERY_MESSAGES,
  PHONE_CODE,
  PHONE_CODE_PURPOSES,
  RECOVERY_HELP_ADDRESS,
  numberChangedSmsText,
  phoneChangeCodeSchema,
  phoneCodeSmsText,
  recoveryCodeRequestSchema,
  recoveryResetSchema,
  resendWaitSeconds,
  smsLength,
  verifiedPhoneChangeSchema,
} from '../src/index';

/**
 * SELF-SERVICE RECOVERY AND A VERIFIED CHANGE OF NUMBER (2026-10-27). The
 * contract the screens and routes share: what each request carries, the
 * resend cooldown, and the fixed SMS texts.
 */

const ID = '11111111-2222-4333-8444-555555555555';

describe('the recovery requests', () => {
  it('a code is asked for by number alone, normalised to +211', () => {
    const parsed = recoveryCodeRequestSchema.safeParse({ phone: '0912 345 678' });
    expect(parsed.success && parsed.data.phone).toBe('+211912345678');
    expect(recoveryCodeRequestSchema.safeParse({ phone: '+254712345678' }).success).toBe(false);
    // Nothing else: no account id, no name, nothing that names the account.
    expect(
      recoveryCodeRequestSchema.safeParse({ phone: '+211912345678', farmer_id: ID }).success,
    ).toBe(false);
  });

  it('a reset carries the verified code and a password of the farmer rules', () => {
    expect(
      recoveryResetSchema.safeParse({ verification_id: ID, password: 'a-good-password' }).success,
    ).toBe(true);
    expect(recoveryResetSchema.safeParse({ verification_id: ID, password: 'short' }).success).toBe(
      false,
    );
    const badId = recoveryResetSchema.safeParse({ verification_id: 'x', password: 'long-enough' });
    expect(badId.error?.issues[0]?.message).toBe(ACCOUNT_RECOVERY_MESSAGES.verificationInvalid);
  });

  it('a change of number carries the new number and the password; the code id is optional', () => {
    expect(phoneChangeCodeSchema.safeParse({ phone: '+211912345678' }).success).toBe(true);
    expect(
      verifiedPhoneChangeSchema.safeParse({ phone: '+211912345678', password: 'x' }).success,
    ).toBe(true);
    expect(
      verifiedPhoneChangeSchema.safeParse({
        phone: '+211912345678',
        password: 'x',
        verification_id: ID,
      }).success,
    ).toBe(true);
    const noPassword = verifiedPhoneChangeSchema.safeParse({ phone: '+211912345678' });
    expect(noPassword.error?.issues[0]?.message).toBe(ACCOUNT_RECOVERY_MESSAGES.passwordRequired);
    expect(
      verifiedPhoneChangeSchema.safeParse({ phone: '+211912345678', password: '' }).success,
    ).toBe(false);
  });
});

describe('the resend cooldown', () => {
  const sent = '2026-10-27T10:00:00.000Z';
  const at = (seconds: number) => Date.parse(sent) + seconds * 1000;

  it('counts down from the cooldown to zero', () => {
    expect(resendWaitSeconds(sent, at(0))).toBe(PHONE_CODE.resendSeconds);
    expect(resendWaitSeconds(sent, at(15))).toBe(PHONE_CODE.resendSeconds - 15);
    expect(resendWaitSeconds(sent, at(PHONE_CODE.resendSeconds))).toBe(0);
    expect(resendWaitSeconds(sent, at(600))).toBe(0);
  });

  it('nothing sent, or an unreadable time, means no wait', () => {
    expect(resendWaitSeconds(null, at(0))).toBe(0);
    expect(resendWaitSeconds('not a time', at(0))).toBe(0);
  });

  it('a clock behind the send time waits the full cooldown, never more', () => {
    expect(resendWaitSeconds(sent, at(-30))).toBe(PHONE_CODE.resendSeconds);
    expect(resendWaitSeconds(sent, at(1), 10)).toBe(9);
  });
});

describe('the text messages', () => {
  it('every code message carries the code, the expiry and fits one SMS in English', () => {
    for (const purpose of PHONE_CODE_PURPOSES) {
      const text = phoneCodeSmsText('123456', purpose, 'en');
      expect(text).toContain('123456');
      expect(text).toContain(`${PHONE_CODE.ttlMinutes} minutes`);
      expect(smsLength(text).segments).toBe(1);
      const arabic = phoneCodeSmsText('123456', purpose, 'ar');
      expect(arabic).toContain('123456');
      expect(smsLength(arabic).segments).toBeLessThanOrEqual(2);
    }
  });

  it('the sign-up code reads exactly as it did before recovery existed', () => {
    expect(phoneCodeSmsText('654321', 'farmer_sign_up', 'en')).toBe(
      `AgriOne code: 654321. It expires in ${PHONE_CODE.ttlMinutes} minutes. Do not share it.`,
    );
  });

  it('the "number changed" message names no number and says where to get help', () => {
    for (const language of ['en', 'ar'] as const) {
      const text = numberChangedSmsText(language);
      expect(text).toContain(RECOVERY_HELP_ADDRESS);
      expect(text).not.toMatch(/\+?211\d|\d{6,}/);
    }
    expect(smsLength(numberChangedSmsText('en')).segments).toBe(1);
  });
});

describe('the migration and the purposes agree', () => {
  const sql = readFileSync(
    fileURLToPath(
      new URL(
        '../../../prisma/migrations/20261027100000_recovery_size_corrections/migration.sql',
        import.meta.url,
      ),
    ),
    'utf8',
  );

  it('the purpose CHECK lists exactly PHONE_CODE_PURPOSES, sign-up kept', () => {
    const match = /"phone_verification_purpose" CHECK\s*\(\s*"purpose" IN \(([^)]*)\)\)/.exec(sql);
    expect(match).not.toBeNull();
    const listed = match![1]!.split(',').map((v) => v.trim().replace(/'/g, ''));
    expect(listed.sort()).toEqual([...PHONE_CODE_PURPOSES].sort());
    expect(listed).toContain('farmer_sign_up');
  });

  it('only a change-of-number code is bound to an account', () => {
    expect(sql).toMatch(/\("purpose" = 'phone_change'\) = \("auth_user_id" IS NOT NULL\)/);
  });
});
