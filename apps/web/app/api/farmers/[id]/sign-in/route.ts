import { farmerAuthIdentifier, farmerPasswordSetSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { conflict } from '../../../../../lib/api/errors';
import { loadVisible } from '../../../../../lib/api/farmers';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';
import {
  createAuthAccount,
  deleteAuthAccount,
  setAuthPassword,
} from '../../../../../lib/supabase/admin';

/**
 * POST /api/farmers/:id/sign-in -- set a farmer's sign-in password (2026-10-08).
 *
 * A farmer's only password reset until SMS is live: the farmer calls CORWADO or
 * their officer, who sets a new password here and tells them. If the farmer has
 * no sign-in yet -- an officer registered them -- this creates it, keyed by the
 * farmer's phone exactly as self-registration does.
 *
 * Who: an administrator; a supervisor for a farmer in their state; an officer
 * for a farmer in their caseload. loadVisible applies that scope, so a farmer
 * outside it is 404. Read-only staff are refused. The password is never
 * recorded; the audit says only that it was set or the sign-in created.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor', 'officer'],
    bodySchema: farmerPasswordSetSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const farmer = await loadVisible(prisma, params.id ?? '', auth);
      const [row] = await prisma.$queryRawUnsafe<{ auth_user_id: string | null }[]>(
        'SELECT auth_user_id FROM public.farmer WHERE id = $1::uuid',
        farmer.id,
      );
      const actor = { actorType: auth.role, actorId: auth.principal.id } as const;

      if (row?.auth_user_id) {
        await setAuthPassword(row.auth_user_id, body.password);
        await audited(prisma, (tx) =>
          writeAudit(tx, {
            entityType: 'farmer',
            entityId: farmer.id,
            ...actor,
            action: 'farmer.updated',
            after: { sign_in: 'password_set' },
          }),
        );
        return ok({ farmer_id: farmer.id, sign_in: 'password_set' });
      }

      let authUserId: string;
      try {
        authUserId = await createAuthAccount(farmerAuthIdentifier(farmer.phone), body.password);
      } catch {
        // That phone already signs in as another farmer account.
        throw conflict('farmer_phone_registered');
      }
      try {
        await audited(prisma, async (tx) => {
          await tx.$executeRawUnsafe(
            `UPDATE public.farmer SET auth_user_id = $2::uuid, updated_at = now()
              WHERE id = $1::uuid AND auth_user_id IS NULL`,
            farmer.id,
            authUserId,
          );
          await writeAudit(tx, {
            entityType: 'farmer',
            entityId: farmer.id,
            ...actor,
            action: 'farmer.updated',
            after: { sign_in: 'account_created' },
          });
        });
      } catch (failure) {
        await deleteAuthAccount(authUserId).catch(() => undefined);
        throw failure;
      }
      return ok({ farmer_id: farmer.id, sign_in: 'account_created' });
    },
  },
});
