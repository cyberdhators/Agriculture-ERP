import { emailCodeVerifySchema } from '@agri-erp/shared';

import { defineRoutes, ok } from '../../../../../lib/api/route';
import { verifyEmailCode } from '../../../../../lib/api/email-verification';

/**
 * POST /api/auth/email-code/verify -- check the code typed at email sign-up
 * (2026-10-28). PUBLIC: there is no account yet. Five tries per code; a
 * verified code is then used up by POST /api/buyer/register.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: emailCodeVerifySchema,
    handler: async ({ body }) => {
      await verifyEmailCode(body.verification_id, body.code);
      return ok({ verified: true });
    },
  },
});
