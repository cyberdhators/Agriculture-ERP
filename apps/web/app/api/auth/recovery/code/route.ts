import { PHONE_CODE, recoveryCodeRequestSchema, type RecoveryCodeSent } from '@agri-erp/shared';

import { recoverableAccount, smsLanguage } from '../../../../../lib/api/account-recovery';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { issuePhoneCode, phoneVerificationRequired } from '../../../../../lib/api/phone-verification';

/**
 * POST /api/auth/recovery/code -- "Forgot your password?" for a phone account
 * (2026-10-27, CORWADO's specification: "Provide resend, change-number and
 * secure recovery functions"). PUBLIC: the person cannot sign in.
 *
 * THE ANSWER NEVER SAYS WHETHER THE NUMBER HAS AN ACCOUNT. For every
 * well-formed South Sudan number a verification row is written -- so the
 * per-number and system-wide limits (and their 429s) are the same either way
 * -- and the same `{ available, verification_id, expires_at }` comes back. The
 * SMS is sent only when the number signs in to a live account, and it is sent
 * AFTER the answer (issuePhoneCode `defer`), so the answer takes the same time
 * too. A row for a number with no account holds the hash of a code nobody was
 * sent, so it can never be verified. Resend is this same call: the 60-second
 * cooldown is enforced in issuePhoneCode.
 *
 * When this deployment sends no codes (no SMS settings, or
 * FARMER_PHONE_VERIFICATION=off) the answer is `{ available: false }` for
 * every number, and the screen says to ask an officer or CORWADO -- the staff
 * reset (POST /api/farmers/:id/sign-in) is kept.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: recoveryCodeRequestSchema,
    handler: async ({ body, request }) => {
      if (!phoneVerificationRequired()) {
        const answer: RecoveryCodeSent = { available: false };
        return ok(answer);
      }
      const account = await recoverableAccount(body.phone);
      const sent = await issuePhoneCode(body.phone, smsLanguage(request), {
        purpose: 'password_recovery',
        deliver: account !== null,
        defer: true,
      });
      const answer: RecoveryCodeSent = {
        available: true,
        verification_id: sent.id,
        expires_at: sent.expiresAt.toISOString(),
        resend_after_seconds: PHONE_CODE.resendSeconds,
      };
      return ok(answer);
    },
  },
});
