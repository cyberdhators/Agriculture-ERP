import {
  FARMER_ACCOUNT_MESSAGES,
  FARMER_ROLE,
  PHONE_CODE,
  phoneChangeCodeSchema,
  type RecoveryCodeSent,
} from '@agri-erp/shared';

import { smsLanguage } from '../../../../../lib/api/account-recovery';
import { ApiFailure } from '../../../../../lib/api/errors';
import { loadSelf } from '../../../../../lib/api/farmer-accounts';
import {
  issuePhoneCode,
  phoneVerificationRequired,
} from '../../../../../lib/api/phone-verification';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { farmerScope } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/farmer/me/phone-code -- send a code to the NEW number before a
 * change of number (2026-10-27, CORWADO's specification: "Provide resend,
 * change-number and secure recovery functions"). The signed-in farmer's own.
 *
 * The code is bound to this account and this new number, and PATCH
 * /api/farmer/me uses it up. Whether the new number already has an account is
 * NOT checked here, so this cannot be used to look numbers up: that is found
 * out only at the change itself, by someone who has just proved they hold the
 * number. Resend is this same call, with the 60-second cooldown.
 *
 * When this deployment sends no codes, `{ available: false }`: the change then
 * needs the password alone, as before.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE],
    bodySchema: phoneChangeCodeSchema,
    handler: async ({ auth, body, request }) => {
      if (!phoneVerificationRequired()) {
        const answer: RecoveryCodeSent = { available: false };
        return ok(answer);
      }
      const { farmerId } = farmerScope(auth);
      const current = await loadSelf(prisma, farmerId);
      if (current.phone === body.phone) {
        throw new ApiFailure(400, 'invalid_input', 'Some of the information sent was not valid.', {
          phone: FARMER_ACCOUNT_MESSAGES.phoneChangesNothing,
        });
      }
      const sent = await issuePhoneCode(body.phone, smsLanguage(request), {
        purpose: 'phone_change',
        authUserId: auth.principal.authUserId,
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
