import { z } from 'zod';

import { farmerPasswordSchema } from './farmer-account';
import { phoneSchema } from './phone';
import { PHONE_CODE } from './phone-verification';

/**
 * SELF-SERVICE RECOVERY AND A VERIFIED CHANGE OF NUMBER (2026-10-27).
 *
 * CORWADO's 16 October specification: "Provide resend, change-number and
 * secure recovery functions", and "ordinary participation must not depend on
 * project staff". A phone account (farmer) forgets its password and sets a new
 * one with a code sent by SMS to its own number; a change of number applies
 * only after a code sent to the NEW number is entered. Staff can still set a
 * farmer's password (POST /api/farmers/:id/sign-in); that path is kept.
 *
 * NEVER REVEAL WHETHER A NUMBER HAS AN ACCOUNT. Asking for a recovery code
 * answers the same for every well-formed South Sudan number, and the same
 * rate limits apply whether or not an account exists, because a row is
 * written either way. Only the SMS differs, and only the phone's holder sees
 * it. docs/DECISIONS.md, "Self-service password recovery and a verified change
 * of number".
 */

/** What a phone_verification row was issued for. The migration's CHECK lists the same three. */
export const PHONE_CODE_PURPOSES = ['farmer_sign_up', 'password_recovery', 'phone_change'] as const;
export type PhoneCodePurpose = (typeof PHONE_CODE_PURPOSES)[number];

// Each pinned in docs/api/CONVENTIONS.md §5.2.3
export const ACCOUNT_RECOVERY_MESSAGES = {
  verificationInvalid: 'Ask for a new code.',
  passwordRequired: 'Enter your current password to confirm.',
} as const;

const verificationId = z
  .string({ error: () => ACCOUNT_RECOVERY_MESSAGES.verificationInvalid })
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    ACCOUNT_RECOVERY_MESSAGES.verificationInvalid,
  );

/** POST /api/auth/recovery/code -- the number of the account that forgot its password. */
export const recoveryCodeRequestSchema = z.strictObject({ phone: phoneSchema });
export type RecoveryCodeRequest = z.infer<typeof recoveryCodeRequestSchema>;

/** POST /api/auth/recovery/reset -- the verified code's id and the new password. */
export const recoveryResetSchema = z.strictObject({
  verification_id: verificationId,
  password: farmerPasswordSchema,
});
export type RecoveryReset = z.infer<typeof recoveryResetSchema>;

/** POST /api/farmer/me/phone-code -- the NEW number a code is sent to. */
export const phoneChangeCodeSchema = z.strictObject({ phone: phoneSchema });
export type PhoneChangeCode = z.infer<typeof phoneChangeCodeSchema>;

/**
 * PATCH /api/farmer/me -- a change of number. The password is checked on the
 * server (it used to be checked only in the browser). `verification_id` is the
 * verified code sent to the new number; the server requires it whenever this
 * deployment sends codes (lib/api/phone-verification.ts).
 */
export const verifiedPhoneChangeSchema = z.strictObject({
  phone: phoneSchema,
  password: z
    .string({ error: () => ACCOUNT_RECOVERY_MESSAGES.passwordRequired })
    .min(1, ACCOUNT_RECOVERY_MESSAGES.passwordRequired)
    .max(200, ACCOUNT_RECOVERY_MESSAGES.passwordRequired),
  verification_id: verificationId.optional(),
});
export type VerifiedPhoneChange = z.infer<typeof verifiedPhoneChangeSchema>;

/** What a code request answers. The same shape whether or not the number has an account. */
export interface RecoveryCodeSent {
  /** False when this deployment sends no codes: recovery is then by an officer or CORWADO. */
  available: boolean;
  verification_id?: string;
  expires_at?: string;
  /** Seconds before another code may be asked for. */
  resend_after_seconds?: number;
}

/**
 * Seconds left before another code may be sent, given when the last one was
 * (ISO time, or null for none) and now. Never negative; never more than the
 * cooldown. The server enforces it (lib/api/phone-verification.ts); the
 * screens count down with the same rule.
 */
export function resendWaitSeconds(
  lastSentAt: string | null,
  nowMs: number,
  cooldownSeconds: number = PHONE_CODE.resendSeconds,
): number {
  if (!lastSentAt) return 0;
  const sent = Date.parse(lastSentAt);
  if (Number.isNaN(sent)) return 0;
  const elapsed = Math.floor((nowMs - sent) / 1000);
  if (elapsed < 0) return cooldownSeconds;
  return Math.max(0, Math.min(cooldownSeconds, cooldownSeconds - elapsed));
}

// ---------------------------------------------------------------------------
// THE TEXT MESSAGES -- fixed sentences; a code, never a name or a number
// ---------------------------------------------------------------------------

/** Where the "was this you?" message sends someone. The Contact CORWADO form is there. */
export const RECOVERY_HELP_ADDRESS = 'agrionesouthsudan.com/help';

/** The SMS that carries a code, for each purpose. */
export function phoneCodeSmsText(
  code: string,
  purpose: PhoneCodePurpose,
  language: 'en' | 'ar',
): string {
  const minutes = PHONE_CODE.ttlMinutes;
  if (language === 'ar') {
    const what =
      purpose === 'password_recovery'
        ? 'لتعيين كلمة مرور جديدة'
        : purpose === 'phone_change'
          ? 'لتأكيد رقمك الجديد'
          : '';
    return `رمز AgriOne${what ? ` ${what}` : ''}: ${code}. صالح لمدة ${minutes} دقائق. لا تشاركه مع أحد.`;
  }
  const what =
    purpose === 'password_recovery'
      ? ' to set a new password'
      : purpose === 'phone_change'
        ? ' to confirm your new number'
        : '';
  return `AgriOne code${what}: ${code}. It expires in ${minutes} minutes. Do not share it.`;
}

/** Sent to the OLD number once a change of number has gone through. */
export function numberChangedSmsText(language: 'en' | 'ar'): string {
  return language === 'ar'
    ? `AgriOne: تم تغيير رقم الهاتف في حسابك. إذا لم تكن أنت، تواصل معنا عبر ${RECOVERY_HELP_ADDRESS}`
    : `AgriOne: the phone number on your account was changed. If this was not you, contact CORWADO at ${RECOVERY_HELP_ADDRESS}`;
}
