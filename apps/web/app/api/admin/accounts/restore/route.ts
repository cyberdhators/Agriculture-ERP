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
 * POST /api/admin/accounts/restore -- staff lift a suspension (2026-10-21).
 * Administrators holding "Moderate content and listings", with a reason.
 *
 * Clears the suspension on the account's farmer and buyer records (one audit
 * row each), then lifts the sign-in ban. The posts come back as they were.
 * Not for a deleted account: its records are out of reach here.
 *
 * 2026-10-26 (CORWADO's acceptance test): the account is told, by one in-app
 * notice with a fixed sentence ("Your AgriOne account has been restored"), on
 * its farmer record or else its buyer's organisation. No text message: the
 * account can sign in again and read it. Restoring never restores an adviser
 * approval that was revoked (lib/api/adviser-approval.ts).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin'],
    bodySchema: accountSanctionSchema,
    handler: async ({ auth, body }) => {
      await requirePermission(auth, 'content.moderate');
      const account = await audited(prisma, async (tx) => {
        const found = await accountOf(tx, body.kind, body.id, true);
        if (!found.suspendedAt) throw unprocessable('account_not_suspended');
        // 2026-10-28: a DISABLED account is lifted only by a Super Admin
        // (POST /api/admin/accounts/reenable), never by an ordinary restore.
        if (found.disabledAt) throw unprocessable('account_disabled_restore');
        for (const [table, id] of [
          ['farmer', found.farmerId],
          ['buyer', found.buyerId],
        ] as const) {
          if (!id) continue;
          await tx.$executeRawUnsafe(
            `UPDATE public.${table}
                SET suspended_at = NULL, suspended_reason = NULL, suspended_by = NULL,
                    suspension_ends_at = NULL
              WHERE id = $1::uuid AND suspended_at IS NOT NULL`,
            id,
          );
          await writeAudit(tx, {
            entityType: table,
            entityId: id,
            actorType: auth.role,
            actorId: auth.principal.id,
            action: 'account.restored',
            before: { suspended: true },
            after: {
              suspended: false,
              reason: body.reason,
              // 2026-10-25: the reason code chosen from the list, if any.
              ...(body.reason_code ? { reason_code: body.reason_code } : {}),
            },
          });
        }
        await notifyAccount(
          tx,
          { authUserId: found.authUserId, farmerId: found.farmerId },
          'account_restored',
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
