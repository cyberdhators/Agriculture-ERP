import { randomUUID } from 'node:crypto';

import { BUYER_ROLE, farmerStartSellingSchema, parseSouthSudanMobile } from '@agri-erp/shared';

import { audited } from '../../../../lib/api/audit';
import { conflict, notFound, unprocessable } from '../../../../lib/api/errors';
import { created, defineRoutes } from '../../../../lib/api/route';
import { createSelfFarmer, placeInPayam } from '../../../../lib/api/self-farmer';
import { prisma } from '../../../../lib/db';

/**
 * POST /api/buyer/selling — a signed-in buyer starts selling, on the same
 * account (2026-10-19; CORWADO's specification, "one account, many
 * activities", and the owner's decision reversing "option A").
 *
 * Writes the account's farmer record exactly as farmer sign-up does
 * (lib/api/self-farmer.ts) -- consent, profile, duplicate check, audit -- and
 * links it to this same sign-in. From then on requireRole answers the account
 * as a farmer on farmer routes. No second password.
 *
 * One farmer record per account: a second request is 409, and so is a phone
 * that already belongs to another farmer's sign-in.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [BUYER_ROLE],
    bodySchema: farmerStartSellingSchema,
    handler: async ({ auth, body }) => {
      if (body.consent.granted !== true) throw unprocessable('consent_required');
      const authUserId = auth.principal.authUserId;

      const [already] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        'SELECT id FROM public.farmer WHERE auth_user_id = $1::uuid LIMIT 1',
        authUserId,
      );
      if (already) throw conflict('farmer_account_exists');

      // The farm's phone: the one given, or the buyer account's own when that
      // is a South Sudan mobile. A farmer record must carry one.
      let phone = body.phone;
      if (!phone) {
        const [buyer] = await prisma.$queryRawUnsafe<{ phone: string | null }[]>(
          'SELECT phone FROM public.buyer_active WHERE auth_user_id = $1::uuid LIMIT 1',
          authUserId,
        );
        if (!buyer) throw notFound();
        const parsed = buyer.phone ? parseSouthSudanMobile(buyer.phone) : null;
        if (!parsed?.ok) throw unprocessable('farmer_phone_required');
        phone = parsed.value;
      }

      const placed = await placeInPayam(body.payam_id);
      const farmerId = randomUUID();
      const consentId = randomUUID();
      const farmerNumber = await audited(prisma, (tx) =>
        createSelfFarmer(tx, {
          farmerId,
          consentId,
          authUserId,
          placed,
          body: { ...body, phone: phone! },
          via: 'buyer_account',
        }),
      );
      return created({ id: farmerId, farmer_number: farmerNumber, verification_status: 'pending' });
    },
  },
});
