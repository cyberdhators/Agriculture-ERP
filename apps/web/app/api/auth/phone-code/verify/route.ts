import { phoneCodeVerifySchema } from '@agri-erp/shared';

import { defineRoutes, ok } from '../../../../../lib/api/route';
import { verifySignUpCode } from '../../../../../lib/api/phone-verification';

/**
 * POST /api/auth/phone-code/verify — check the code the farmer typed
 * (2026-10-19). PUBLIC: the farmer has no account yet. Five tries per code;
 * a verified code is then used up by POST /api/farmer/register.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: phoneCodeVerifySchema,
    handler: async ({ body }) => {
      await verifySignUpCode(body.verification_id, body.code);
      return ok({ verified: true });
    },
  },
});
