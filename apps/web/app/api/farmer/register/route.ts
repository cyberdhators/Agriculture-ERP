import { randomUUID } from 'node:crypto';

import { farmerAuthIdentifier, farmerSelfRegisterSchema } from '@agri-erp/shared';

import { audited, writeAuditOutcome } from '../../../../lib/api/audit';
import { authUnavailable, conflict, unprocessable } from '../../../../lib/api/errors';
import {
  consumeSignUpVerification,
  phoneVerificationRequired,
} from '../../../../lib/api/phone-verification';
import { createSelfFarmer, placeInPayam } from '../../../../lib/api/self-farmer';
import { created, defineRoutes } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';
import {
  AuthUnavailableError,
  createAuthAccount,
  deleteAuthAccount,
} from '../../../../lib/supabase/admin';

/**
 * POST /api/farmer/register -- a farmer enrols themselves. B14 (2026-10-07).
 *
 * PUBLIC, BECAUSE THE FARMER HAS NO ACCOUNT YET. CORWADO has no staff to
 * enrol farmers, so farmers register themselves; officers help the few who
 * cannot, through the officer's own registration (DECISIONS, "Farmers enrol
 * themselves and deal with buyers directly").
 *
 * What it writes, in one transaction: the farmer record (source `self`,
 * standing `pending`, no registering officer), the consent the farmer gave,
 * the profile from CORWADO's registration form, and the audit rows -- with the
 * farmer as the actor. The sign-in account is created first and removed again
 * if the transaction fails. The farmer is assigned to an active officer in
 * their payam when there is one, so a verification can happen later; when
 * there is none the farmer is still registered and still sells.
 *
 * A self-registered farmer is `pending`: they appear in the marketplace marked
 * unverified, and they are counted in no reach figure until an officer
 * verifies them (CLAUDE.md, Reporting). Verification is not required to sell.
 *
 * KNOWINGLY UNCLOSED: there is no rate limiter (none exists in the system),
 * and a phone that already has an account answers 409, which says so.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: farmerSelfRegisterSchema,
    handler: async ({ body }) => {
      if (body.consent.granted !== true) throw unprocessable('consent_required');

      // The payam is checked before any account exists, so a typo costs the
      // farmer a 422 and costs the system nothing to undo.
      const placed = await placeInPayam(body.payam_id);
      // Checked before the sign-in exists, and again (atomically) when used up.
      const verifyPhone = phoneVerificationRequired();
      if (verifyPhone && !body.verification_id) throw unprocessable('phone_not_verified');

      let authUserId: string;
      try {
        authUserId = await createAuthAccount(farmerAuthIdentifier(body.phone), body.password);
      } catch (failure) {
        if (failure instanceof AuthUnavailableError) throw authUnavailable();
        throw conflict('farmer_phone_registered');
      }

      const farmerId = randomUUID();
      const consentId = randomUUID();
      try {
        const farmerNumber = await audited(prisma, async (tx) => {
          // 2026-10-19: the phone proved by SMS code, used up with the sign-up.
          if (verifyPhone) await consumeSignUpVerification(tx, body.verification_id, body.phone);
          return createSelfFarmer(tx, {
            farmerId,
            consentId,
            authUserId,
            placed,
            body,
            via: 'sign_up',
          });
        });

        return created({
          id: farmerId,
          farmer_number: farmerNumber,
          verification_status: 'pending',
        });
      } catch (failure) {
        const compensated = await deleteAuthAccount(authUserId)
          .then(() => true)
          .catch(() => false);
        if (!compensated) {
          await writeAuditOutcome({
            entityType: 'auth_account',
            entityId: authUserId,
            actorType: 'system',
            actorId: null,
            action: 'auth.account_orphaned',
          }).catch(() => undefined);
        }
        throw failure;
      }
    },
  },
});
