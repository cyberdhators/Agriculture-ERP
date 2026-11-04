import { ALL_ROLES, BUYER_ROLE, FARMER_ROLE, pushRemoveSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/account/push-subscription/remove (2026-11-03). Alerts stop for
 * this phone at sign-out. Only the account's own row, and asking twice is
 * harmless. Soft delete, audited, no address or key.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [...ALL_ROLES, FARMER_ROLE, BUYER_ROLE],
    bodySchema: pushRemoveSchema,
    handler: async ({ auth, body }) => {
      await audited(prisma, async (tx) => {
        const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `UPDATE public.push_subscription SET deleted_at = now(), updated_at = now()
            WHERE endpoint = $1 AND auth_user_id = $2::uuid AND deleted_at IS NULL
            RETURNING id`,
          body.endpoint,
          auth.principal.authUserId,
        );
        if (!row) return;
        await writeAudit(tx, {
          entityType: 'push_subscription',
          entityId: row.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'push_subscription.removed',
          after: { reason: 'member' },
        });
      });
      return ok({ on: false });
    },
  },
});
