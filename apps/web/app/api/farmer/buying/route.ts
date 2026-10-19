import { FARMER_ROLE, initialStanding } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { notFound } from '../../../../lib/api/errors';
import { created, defineRoutes, ok } from '../../../../lib/api/route';
import { farmerScope } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * POST /api/farmer/buying — a signed-in farmer starts buying, on the same
 * account (2026-10-19; CORWADO's specification, "one account, many
 * activities", and the owner's decision reversing "option A").
 *
 * Makes the account's personal buyer profile from the farmer's own name and
 * phone: an individual account, standing as any individual buyer's does
 * (initialStanding). No second sign-up and no second password: requireRole
 * answers the same sign-in as a buyer on buyer routes and as a farmer on
 * farmer routes. Asking twice is the same as asking once -- the existing
 * profile comes back (200), so a double tap or a retry is harmless.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE],
    handler: async ({ auth }) => {
      const { farmerId } = farmerScope(auth);
      const [existing] = await prisma.$queryRawUnsafe<{ id: string; organization_id: string }[]>(
        'SELECT id, organization_id FROM public.buyer_active WHERE auth_user_id = $1::uuid LIMIT 1',
        auth.principal.authUserId,
      );
      if (existing) {
        return ok({ buyer_id: existing.id, organization_id: existing.organization_id });
      }

      const [farmer] = await prisma.$queryRawUnsafe<
        {
          given_name: string;
          family_name: string;
          phone: string;
          state_id: string;
          county_id: string;
        }[]
      >(
        `SELECT given_name, family_name, phone, state_id, county_id
           FROM public.farmer_active WHERE id = $1::uuid`,
        farmerId,
      );
      if (!farmer) throw notFound();

      const standing = initialStanding('individual');
      const result = await audited(prisma, async (tx) => {
        const [organization] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.buyer_organization
             (name, organization_type, country_code, state_id, county_id,
              account_type, verification_status)
           VALUES ($1, 'other'::public.buyer_organization_type, 'SS', $2, $3,
                   'individual'::public.buyer_account_type,
                   $4::public.buyer_verification_status)
           RETURNING id`,
          `${farmer.given_name} ${farmer.family_name}`,
          farmer.state_id,
          farmer.county_id,
          standing,
        );
        const [buyer] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.buyer (auth_user_id, organization_id, given_name, family_name, phone)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5) RETURNING id`,
          auth.principal.authUserId,
          organization!.id,
          farmer.given_name,
          farmer.family_name,
          farmer.phone,
        );
        await writeAudit(tx, {
          entityType: 'buyer_organization',
          entityId: organization!.id,
          actorType: 'farmer',
          actorId: farmerId,
          action: 'buyer.registered',
          // No name or phone: the audit keeps who and how, not personal data.
          after: {
            buyer_id: buyer!.id,
            account_type: 'individual',
            organization_type: 'other',
            country_code: 'SS',
            state_id: farmer.state_id,
            verification_status: standing,
            from: 'farmer_account',
            farmer_id: farmerId,
          },
        });
        return { buyerId: buyer!.id, organizationId: organization!.id };
      });
      return created({ buyer_id: result.buyerId, organization_id: result.organizationId });
    },
  },
});
