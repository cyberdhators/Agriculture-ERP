import { FARMER_ROLE, farmerDetailsSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { loadSelf } from '../../../../../lib/api/farmer-accounts';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { farmerScope } from '../../../../../lib/api/scope';
import { placeInPayam } from '../../../../../lib/api/self-farmer';
import { prisma } from '../../../../../lib/db';

/**
 * PATCH /api/farmer/me/details -- the details sign-up no longer asks for
 * (2026-10-28, user journeys; the specification, lines 38-39: "Optional setup
 * follows activation and can be skipped. Collect further details at the point
 * they are needed").
 *
 * The session's own record only: sex, year of birth, location (payam, with
 * its county and state) and village. Each field is optional; one left out is
 * left as it is. A location given to an account with no officer places it
 * with an active officer of that payam, as sign-up does, so a verification
 * can follow. The farmer number is never re-derived (C-5.4). The audit row
 * names the fields changed, never their values.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: [FARMER_ROLE],
    bodySchema: farmerDetailsSchema,
    handler: async ({ auth, body }) => {
      const { farmerId } = farmerScope(auth);
      const placed = body.payam_id ? await placeInPayam(body.payam_id) : null;

      await audited(prisma, async (tx) => {
        const [before] = await tx.$queryRawUnsafe<{ caseload_officer_id: string | null }[]>(
          `SELECT caseload_officer_id FROM public.farmer_active WHERE id = $1::uuid FOR UPDATE`,
          farmerId,
        );
        const changed: string[] = [];
        if (body.sex !== undefined) {
          await tx.$executeRawUnsafe(
            `UPDATE public.farmer SET sex = $2::public.sex, updated_at = now() WHERE id = $1::uuid`,
            farmerId,
            body.sex,
          );
          changed.push('sex');
        }
        if (body.year_of_birth !== undefined) {
          await tx.$executeRawUnsafe(
            `UPDATE public.farmer SET year_of_birth = $2, updated_at = now() WHERE id = $1::uuid`,
            farmerId,
            body.year_of_birth,
          );
          changed.push('year_of_birth');
        }
        let officerAssigned = false;
        if (placed?.payam) {
          const assignOfficer = !before?.caseload_officer_id && placed.officerId !== null;
          await tx.$executeRawUnsafe(
            `UPDATE public.farmer
                SET payam_id = $2, county_id = $3, state_id = $4,
                    caseload_officer_id = CASE WHEN $5 THEN $6::uuid ELSE caseload_officer_id END,
                    updated_at = now()
              WHERE id = $1::uuid`,
            farmerId,
            placed.payam.id,
            placed.payam.county_id,
            placed.payam.state_id,
            assignOfficer,
            placed.officerId,
          );
          officerAssigned = assignOfficer;
          changed.push('location');
        }
        if (body.village !== undefined && body.village !== null) {
          await tx.$executeRawUnsafe(
            `INSERT INTO public.farmer_profile (farmer_id, village) VALUES ($1::uuid, $2)
             ON CONFLICT (farmer_id) DO UPDATE SET village = EXCLUDED.village, updated_at = now()`,
            farmerId,
            body.village,
          );
          changed.push('village');
        }
        await writeAudit(tx, {
          entityType: 'farmer',
          entityId: farmerId,
          actorType: 'farmer',
          actorId: farmerId,
          action: 'farmer.updated',
          after: {
            changed,
            ...(placed?.payam
              ? {
                  payam_id: placed.payam.id,
                  county_id: placed.payam.county_id,
                  state_id: placed.payam.state_id,
                }
              : {}),
            ...(officerAssigned ? { caseload_officer_id: placed?.officerId } : {}),
          },
        });
      });
      return ok(await loadSelf(prisma, farmerId));
    },
  },
});
