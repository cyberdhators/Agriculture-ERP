import { accountSanctionSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { unprocessable } from '../../../../../lib/api/errors';
import { accountOf, standingOf } from '../../../../../lib/api/moderation';
import { requirePermission } from '../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';
import { disableAuthAccount } from '../../../../../lib/supabase/admin';

/**
 * POST /api/admin/accounts/suspend -- staff suspend a farmer or buyer account
 * (2026-10-21). Administrators holding "Moderate content and listings".
 *
 * In one transaction: the account's farmer and buyer records carry
 * suspended_at, the reason and who did it, and one audit row per record. From
 * the next request the account is refused everywhere (requireRole), and
 * nothing it posted is on the market (the market's joins). Its posts keep
 * their own status, so restoring brings them back as they were.
 *
 * Then the sign-in is banned, ending sessions on every phone. If Supabase does
 * not answer, the suspension already holds; the answer says the ban did not.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin'],
    bodySchema: accountSanctionSchema,
    handler: async ({ auth, body }) => {
      await requirePermission(auth, 'content.moderate');
      const account = await audited(prisma, async (tx) => {
        const found = await accountOf(tx, body.kind, body.id, true);
        if (found.suspendedAt) throw unprocessable('account_already_suspended');
        for (const [table, id] of [
          ['farmer', found.farmerId],
          ['buyer', found.buyerId],
        ] as const) {
          if (!id) continue;
          await tx.$executeRawUnsafe(
            `UPDATE public.${table}
                SET suspended_at = now(), suspended_reason = $2, suspended_by = $3::uuid
              WHERE id = $1::uuid AND suspended_at IS NULL`,
            id,
            body.reason,
            auth.principal.id,
          );
          await writeAudit(tx, {
            entityType: table,
            entityId: id,
            actorType: auth.role,
            actorId: auth.principal.id,
            action: 'account.suspended',
            before: { suspended: false },
            after: { suspended: true, reason: body.reason },
          });
        }
        return accountOf(tx, body.kind, body.id);
      });

      let signInBlocked = account.authUserId === null;
      if (account.authUserId) {
        try {
          await disableAuthAccount(account.authUserId);
          signInBlocked = true;
        } catch {
          signInBlocked = false;
        }
      }
      return ok({ ...standingOf(account), sign_in_blocked: signInBlocked });
    },
  },
});
