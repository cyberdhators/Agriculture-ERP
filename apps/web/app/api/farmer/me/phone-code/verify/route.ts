import { FARMER_ROLE, phoneCodeVerifySchema } from '@agri-erp/shared';

import { verifyPhoneCode } from '../../../../../../lib/api/phone-verification';
import { defineRoutes, ok } from '../../../../../../lib/api/route';

/**
 * POST /api/farmer/me/phone-code/verify -- check the code sent to the new
 * number (2026-10-27). The signed-in farmer's own: only a change-of-number
 * code issued to THIS account is accepted. Five tries per code. The verified
 * code is then used up by PATCH /api/farmer/me.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE],
    bodySchema: phoneCodeVerifySchema,
    handler: async ({ auth, body }) => {
      await verifyPhoneCode(
        body.verification_id,
        body.code,
        'phone_change',
        auth.principal.authUserId,
      );
      return ok({ verified: true });
    },
  },
});
