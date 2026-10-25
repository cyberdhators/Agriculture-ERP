import { phoneCodeVerifySchema } from '@agri-erp/shared';

import { defineRoutes, ok } from '../../../../../lib/api/route';
import { verifyPhoneCode } from '../../../../../lib/api/phone-verification';

/**
 * POST /api/auth/recovery/verify -- check the recovery code the person typed
 * (2026-10-27). PUBLIC. Five tries per code, as at sign-up. Only a
 * password_recovery code is accepted here. A code issued for a number with no
 * account was never sent and cannot match, so this answers "wrong" exactly as
 * it would for a mistyped code: nothing here tells the two apart. A verified
 * code is then used up by POST /api/auth/recovery/reset.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: phoneCodeVerifySchema,
    handler: async ({ body }) => {
      await verifyPhoneCode(body.verification_id, body.code, 'password_recovery');
      return ok({ verified: true });
    },
  },
});
