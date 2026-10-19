import { phoneCodeRequestSchema, type PhoneCodeSent } from '@agri-erp/shared';

import { conflict } from '../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { phoneVerificationRequired, sendSignUpCode } from '../../../../lib/api/phone-verification';
import { prisma } from '../../../../lib/db';

/**
 * POST /api/auth/phone-code — send a 6-digit code by SMS to the phone a farmer
 * is signing up with (2026-10-19). PUBLIC: the farmer has no account yet.
 *
 * When this deployment does not verify phones (no SMS settings, or
 * FARMER_PHONE_VERIFICATION=off) it answers `{ required: false }` and sends
 * nothing; sign-up then needs no code. A phone that already has a farmer
 * account gets 409 and no SMS -- the SMS would cost money and lead nowhere.
 * Rate limits: lib/api/phone-verification.ts.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: phoneCodeRequestSchema,
    handler: async ({ body, request }) => {
      if (!phoneVerificationRequired()) {
        const answer: PhoneCodeSent = { required: false };
        return ok(answer);
      }
      const [taken] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM public.farmer_active
          WHERE phone = $1 AND auth_user_id IS NOT NULL AND merged_into IS NULL LIMIT 1`,
        body.phone,
      );
      if (taken) throw conflict('farmer_phone_registered');
      const language = (request.headers.get('accept-language') ?? '').startsWith('ar')
        ? 'ar'
        : 'en';
      const sent = await sendSignUpCode(body.phone, language);
      const answer: PhoneCodeSent = {
        required: true,
        verification_id: sent.id,
        expires_at: sent.expiresAt.toISOString(),
      };
      return ok(answer);
    },
  },
});
