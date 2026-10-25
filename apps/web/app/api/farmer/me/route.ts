import {
  FARMER_ACCOUNT_MESSAGES,
  FARMER_ROLE,
  farmerAuthIdentifier,
  verifiedPhoneChangeSchema,
} from '@agri-erp/shared';

import { recordVisit } from '../../../../lib/api/access-log';
import { sendNumberChangedSms, smsLanguage } from '../../../../lib/api/account-recovery';
import { audited, writeAudit } from '../../../../lib/api/audit';
import { ApiFailure, conflict } from '../../../../lib/api/errors';
import { loadSelf } from '../../../../lib/api/farmer-accounts';
import { notifyAccount } from '../../../../lib/api/notify';
import {
  consumeVerification,
  phoneVerificationRequired,
  releaseVerification,
} from '../../../../lib/api/phone-verification';
import { reauthenticate } from '../../../../lib/api/reauth';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { farmerScope } from '../../../../lib/api/scope';
import { requireReauth } from '../../../../lib/api/staff-access';
import { prisma } from '../../../../lib/db';
import { setAuthIdentifier } from '../../../../lib/supabase/admin';

/**
 * GET and PATCH /api/farmer/me -- the signed-in farmer's own record. B14.
 *
 * No id in the address: the record is the session's. The PATCH changes the
 * phone number, which is also the sign-in identifier, so the identifier moves
 * with it. The route changes only what the session owns.
 *
 * VERIFIED CHANGE OF NUMBER (2026-10-27, CORWADO's specification). The
 * password is now checked HERE (reauthenticate, on a throwaway session),
 * not only in the browser; and when this deployment sends codes, the change
 * needs a verified code sent to the NEW number (POST /api/farmer/me/phone-code
 * and its /verify), bound to this account. The OLD number is told by SMS, the
 * account gets an in-app notice, and the audit row records how it was
 * verified and whether the SMS went -- never either number.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE],
    handler: async ({ auth, request }) => {
      // STAFF PERMISSIONS LANE (2026-10-19): the one access-log call in the
      // farmer routes. Farmers sign in in the browser, so this is the first
      // place a server sees them. recordVisit never throws and gives up after
      // two seconds; the response is exactly what it was.
      await recordVisit(auth, request);
      return ok(await loadSelf(prisma, farmerScope(auth).farmerId));
    },
  },

  PATCH: {
    roles: [FARMER_ROLE],
    bodySchema: verifiedPhoneChangeSchema,
    handler: async ({ auth, body, request }) => {
      const { farmerId } = farmerScope(auth);
      const authUserId = auth.principal.authUserId;
      const current = await loadSelf(prisma, farmerId);
      if (current.phone === body.phone) {
        throw new ApiFailure(400, 'invalid_input', 'Some of the information sent was not valid.', {
          phone: FARMER_ACCOUNT_MESSAGES.phoneChangesNothing,
        });
      }
      await requireReauth(await reauthenticate(authUserId, body.password), async () => undefined);
      // The code sent to the new number, for this account, used up here.
      const verified = phoneVerificationRequired();
      if (verified) {
        await consumeVerification(prisma, body.verification_id, 'phone_change', {
          phone: body.phone,
          authUserId,
        });
      }
      // The identifier first: if the new phone already has an account, nothing changes.
      try {
        await setAuthIdentifier(authUserId, farmerAuthIdentifier(body.phone));
      } catch {
        if (verified && body.verification_id) await releaseVerification(body.verification_id);
        throw conflict('farmer_phone_registered');
      }
      await audited(prisma, async (tx) => {
        await tx.$executeRawUnsafe(
          'UPDATE public.farmer SET phone = $2, updated_at = now() WHERE id = $1::uuid',
          farmerId,
          body.phone,
        );
        // The listings that carried the old number now carry the new one, so a
        // buyer who sends a request is given a number that works. A listing the
        // farmer deliberately gave another number keeps it. (2026-10-08)
        const moved = await tx.$queryRawUnsafe<{ id: string }[]>(
          `UPDATE public.produce_listing SET contact_phone = $3, updated_at = now()
            WHERE farmer_id = $1::uuid AND contact_phone = $2 AND deleted_at IS NULL
            RETURNING id`,
          farmerId,
          current.phone,
          body.phone,
        );
        // The OLD number is told; the outcome goes in the audit row, never the text.
        const oldNumberSms = verified
          ? await sendNumberChangedSms(current.phone, smsLanguage(request))
          : 'not_sent';
        await writeAudit(tx, {
          entityType: 'farmer',
          entityId: farmerId,
          actorType: 'farmer',
          actorId: farmerId,
          action: 'farmer.updated',
          // Which field changed, never its value: a phone never enters the log.
          after: {
            changed: ['phone'],
            listings_updated: moved.length,
            verified_by: verified ? 'password_and_sms_code' : 'password',
            old_number_sms: oldNumberSms,
          },
        });
        await notifyAccount(tx, { authUserId, farmerId }, 'phone_changed', {
          actorType: 'farmer',
          actorId: farmerId,
        });
      });
      return ok(await loadSelf(prisma, farmerId));
    },
  },
});
