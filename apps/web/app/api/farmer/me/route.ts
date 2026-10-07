import {
  FARMER_ACCOUNT_MESSAGES,
  FARMER_ROLE,
  farmerAuthIdentifier,
  farmerPhoneChangeSchema,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { ApiFailure, conflict } from '../../../../lib/api/errors';
import { loadSelf } from '../../../../lib/api/farmer-accounts';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { farmerScope } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';
import { setAuthIdentifier } from '../../../../lib/supabase/admin';

/**
 * GET and PATCH /api/farmer/me -- the signed-in farmer's own record. B14.
 *
 * No id in the address: the record is the session's. The PATCH changes the
 * phone number, which is also the sign-in identifier, so the identifier moves
 * with it. The screen asks for the password and checks it by signing in
 * before calling this; the route changes only what the session owns.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE],
    handler: async ({ auth }) => ok(await loadSelf(prisma, farmerScope(auth).farmerId)),
  },

  PATCH: {
    roles: [FARMER_ROLE],
    bodySchema: farmerPhoneChangeSchema,
    handler: async ({ auth, body }) => {
      const { farmerId } = farmerScope(auth);
      const current = await loadSelf(prisma, farmerId);
      if (current.phone === body.phone) {
        throw new ApiFailure(400, 'invalid_input', 'Some of the information sent was not valid.', {
          phone: FARMER_ACCOUNT_MESSAGES.phoneChangesNothing,
        });
      }
      // The identifier first: if the new phone already has an account, nothing changes.
      try {
        await setAuthIdentifier(auth.principal.authUserId, farmerAuthIdentifier(body.phone));
      } catch {
        throw conflict('farmer_phone_registered');
      }
      await audited(prisma, async (tx) => {
        await tx.$executeRawUnsafe(
          'UPDATE public.farmer SET phone = $2, updated_at = now() WHERE id = $1::uuid',
          farmerId,
          body.phone,
        );
        await writeAudit(tx, {
          entityType: 'farmer',
          entityId: farmerId,
          actorType: 'farmer',
          actorId: farmerId,
          action: 'farmer.updated',
          // Which field changed, never its value: a phone never enters the log.
          after: { changed: ['phone'] },
        });
      });
      return ok(await loadSelf(prisma, farmerId));
    },
  },
});
