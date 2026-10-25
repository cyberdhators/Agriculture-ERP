import { emailCodeRequestSchema, type EmailCodeSent } from '@agri-erp/shared';

import { defineRoutes, ok } from '../../../../lib/api/route';
import {
  emailVerificationRequired,
  sendEmailSignUpCode,
} from '../../../../lib/api/email-verification';

/**
 * POST /api/auth/email-code -- send a 6-digit code to the address someone is
 * signing up with (2026-10-28, user journeys). PUBLIC: there is no account yet.
 *
 * When this deployment does not verify addresses (no Resend settings, or
 * EMAIL_VERIFICATION=off) it answers `{ required: false }` and sends nothing;
 * sign-up then needs no code. Unlike the phone route, it NEVER says whether
 * the address already has an account: any well-formed address within the
 * limits is sent a code. Rate limits: lib/api/email-verification.ts.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: emailCodeRequestSchema,
    handler: async ({ body }) => {
      if (!emailVerificationRequired()) {
        const answer: EmailCodeSent = { required: false };
        return ok(answer);
      }
      const sent = await sendEmailSignUpCode(body.email, body.language);
      const answer: EmailCodeSent = {
        required: true,
        verification_id: sent.id,
        expires_at: sent.expiresAt.toISOString(),
      };
      return ok(answer);
    },
  },
});
