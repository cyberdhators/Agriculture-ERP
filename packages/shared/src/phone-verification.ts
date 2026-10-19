import { z } from 'zod';

import { phoneSchema } from './phone';

/**
 * PHONE VERIFICATION BY SMS CODE (2026-10-19). CORWADO's specification:
 * "Contact verification activates the account automatically" -- a farmer
 * signing up receives a code by SMS and the sign-up completes only with it.
 */

export const PHONE_CODE = {
  /** Digits in a code. */
  length: 6,
  /** How long a code works. */
  ttlMinutes: 10,
  /** Wrong tries before a code stops working. */
  maxAttempts: 5,
  /** Codes one phone may be sent in `windowMinutes`. */
  perPhone: 3,
  windowMinutes: 30,
  /** Seconds before the same phone may be sent another code. */
  resendSeconds: 60,
  /** Codes the whole system may send in an hour -- a ceiling on the SMS bill. */
  perHourSystem: 200,
  /** How long after verifying the code the sign-up must be completed. */
  useWithinMinutes: 30,
} as const;

export const PHONE_CODE_MESSAGES = {
  codeShape: `Enter the ${PHONE_CODE.length}-digit code from the SMS.`,
  idInvalid: 'Ask for a new code.',
} as const;

/** POST /api/auth/phone-code -- send a code to this phone for farmer sign-up. */
export const phoneCodeRequestSchema = z.strictObject({
  phone: phoneSchema,
});

/** POST /api/auth/phone-code/verify -- the code the farmer typed. */
export const phoneCodeVerifySchema = z.strictObject({
  verification_id: z
    .string({ error: () => PHONE_CODE_MESSAGES.idInvalid })
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      PHONE_CODE_MESSAGES.idInvalid,
    ),
  code: z
    .string({ error: () => PHONE_CODE_MESSAGES.codeShape })
    .trim()
    .regex(new RegExp(`^[0-9]{${PHONE_CODE.length}}$`), PHONE_CODE_MESSAGES.codeShape),
});

export type PhoneCodeRequest = z.infer<typeof phoneCodeRequestSchema>;
export type PhoneCodeVerify = z.infer<typeof phoneCodeVerifySchema>;

/** What POST /api/auth/phone-code answers. */
export interface PhoneCodeSent {
  /** False when this deployment does not verify phones: sign up without a code. */
  required: boolean;
  verification_id?: string;
  expires_at?: string;
}
