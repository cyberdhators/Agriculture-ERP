import { randomUUID } from 'node:crypto';

import { farmerAuthIdentifier, farmerSelfRegisterSchema } from '@agri-erp/shared';

import { audited, writeAudit, writeAuditOutcome } from '../../../../lib/api/audit';
import { issueRecoveryCode } from '../../../../lib/api/recovery';
import { authUnavailable, conflict, unprocessable } from '../../../../lib/api/errors';
import {
  allocateFarmerNumber,
  findDuplicates,
  recordDuplicates,
} from '../../../../lib/api/farmers';
import { insertProfile } from '../../../../lib/api/farmer-accounts';
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

      const [payam] = await prisma.$queryRawUnsafe<
        { id: string; county_id: string; state_id: string }[]
      >('SELECT id, county_id, state_id FROM public.payam_active WHERE id = $1', body.payam_id);
      if (!payam) throw unprocessable('payam_not_found');

      // An officer for later verification, if the payam has one. Never a test officer.
      const [officer] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM public.officer_active
          WHERE payam_id = $1 AND name NOT LIKE 'zztest%' ORDER BY created_at LIMIT 1`,
        payam.id,
      );

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
        const { number: farmerNumber, recoveryCode } = await audited(prisma, async (tx) => {
          const number = await allocateFarmerNumber(tx, payam.county_id);
          await tx.$executeRawUnsafe(
            `INSERT INTO public.farmer
               (id, farmer_number, given_name, family_name, sex, year_of_birth, phone, national_id,
                payam_id, county_id, state_id, registered_by, caseload_officer_id,
                registration_source, consent_id, auth_user_id)
             VALUES ($1::uuid, $2, $3, $4, $5::public.sex, $6, $7, $8, $9, $10, $11, NULL,
                     $12::uuid, 'self', $13::uuid, $14::uuid)`,
            farmerId,
            number,
            body.given_name,
            body.family_name,
            body.sex,
            body.year_of_birth,
            body.phone,
            // The farmer record's national id keeps its strict shape (C-5.2);
            // any other document lives on the profile.
            body.id_type === 'national_id' &&
              body.id_number &&
              /^[0-9A-Z]{6,20}$/.test(body.id_number)
              ? body.id_number
              : null,
            payam.id,
            payam.county_id,
            payam.state_id,
            officer?.id ?? null,
            consentId,
            authUserId,
          );
          await tx.$executeRawUnsafe(
            `INSERT INTO public.consent (id, farmer_id, text_version, language, granted)
             VALUES ($1::uuid, $2::uuid, $3, $4::public.language, true)`,
            consentId,
            farmerId,
            body.consent.text_version,
            body.consent.language,
          );
          await insertProfile(tx, farmerId, body);

          const matches = await findDuplicates(tx, {
            id: farmerId,
            phone: body.phone,
            given_name: body.given_name,
            family_name: body.family_name,
            payam_id: payam.id,
          });
          if (matches.length > 0) await recordDuplicates(tx, farmerId, matches);

          const actor = { actorType: 'farmer', actorId: farmerId } as const;
          await writeAudit(tx, {
            entityType: 'farmer',
            entityId: farmerId,
            ...actor,
            action: 'farmer.created',
            // No name, phone or id number: auditSafe strips them by key, and
            // they are not passed.
            after: {
              farmer_number: number,
              registration_source: 'self',
              payam_id: payam.id,
              county_id: payam.county_id,
              state_id: payam.state_id,
              caseload_officer_id: officer?.id ?? null,
            },
          });
          await writeAudit(tx, {
            entityType: 'consent',
            entityId: consentId,
            ...actor,
            action: 'consent.recorded',
            after: {
              farmer_id: farmerId,
              text_version: body.consent.text_version,
              language: body.consent.language,
              granted: true,
            },
          });
          // The first recovery code (2026-10-09), shown once on the done screen.
          const code = await issueRecoveryCode(tx, authUserId);
          return { number, recoveryCode: code };
        });

        return created({
          id: farmerId,
          farmer_number: farmerNumber,
          recovery_code: recoveryCode,
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
