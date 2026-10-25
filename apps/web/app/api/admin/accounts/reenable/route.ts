import { accountSanctionSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { unprocessable } from '../../../../../lib/api/errors';
import { accountOf, standingOf } from '../../../../../lib/api/moderation';
import { notifyAccount } from '../../../../../lib/api/notify';
import { requirePermission } from '../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';
import { enableAuthAccount } from '../../../../../lib/supabase/admin';

/**
 * POST /api/admin/accounts/reenable -- a SUPER ADMIN lifts a disable
 * (2026-10-28), with a reason. Administrators only, and then
 * `superadmin.grant`, which only a Super Admin holds: an ordinary moderator
 * who may disable may not undo it ("restorable by Super Admin only").
 *
 * Clears the disable AND the suspension beneath it on the account's farmer
 * and buyer records (one account.reenabled audit row each, with the reason),
 * tells the account with a fixed in-app notice, then lifts the sign-in ban.
 * The posts come back as they were, as on Restore.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin'],
    bodySchema: accountSanctionSchema,
    handler: async ({ auth, body }) => {
      await requirePermission(auth, 'superadmin.grant');
      const account = await audited(prisma, async (tx) => {
        const found = await accountOf(tx, body.kind, body.id, true);
        if (!found.disabledAt) throw unprocessable('account_not_disabled');
        for (const [table, id] of [
          ['farmer', found.farmerId],
          ['buyer', found.buyerId],
        ] as const) {
          if (!id) continue;
          await tx.$executeRawUnsafe(
            `UPDATE public.${table}
                SET disabled_at = NULL, disabled_reason = NULL, disabled_by = NULL,
                    suspended_at = NULL, suspended_reason = NULL, suspended_by = NULL
              WHERE id = $1::uuid AND disabled_at IS NOT NULL`,
            id,
          );
          await writeAudit(tx, {
            entityType: table,
            entityId: id,
            actorType: auth.role,
            actorId: auth.principal.id,
            action: 'account.reenabled',
            before: { disabled: true, suspended: true },
            after: {
              disabled: false,
              suspended: false,
              reason: body.reason,
              ...(body.reason_code ? { reason_code: body.reason_code } : {}),
            },
          });
        }
        await notifyAccount(
          tx,
          { authUserId: found.authUserId, farmerId: found.farmerId },
          'account_reenabled',
          { actorType: auth.role, actorId: auth.principal.id },
        );
        return accountOf(tx, body.kind, body.id);
      });

      let signInRestored = account.authUserId === null;
      if (account.authUserId) {
        try {
          await enableAuthAccount(account.authUserId);
          signInRestored = true;
        } catch {
          signInRestored = false;
        }
      }
      return ok({ ...standingOf(account), sign_in_restored: signInRestored });
    },
  },
});
