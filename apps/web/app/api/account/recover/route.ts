import {
  FARMER_ACCOUNT_MESSAGES,
  accountRecoverSchema,
  farmerAuthIdentifier,
  farmerPasswordSchema,
  passwordSchema,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { ApiFailure, unprocessable } from '../../../../lib/api/errors';
import {
  checkRecoveryCode,
  equaliseRecoveryTiming,
  issueRecoveryCode,
} from '../../../../lib/api/recovery';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';
import { setAuthPassword } from '../../../../lib/supabase/admin';

/**
 * POST /api/account/recover -- a farmer or buyer sets a new password with their
 * recovery code (2026-10-09). Public: the person cannot sign in, which is the
 * point.
 *
 * The identifier is a phone number (a farmer) or an email address (a buyer).
 * Staff and officers are not served here: their passwords are set by an
 * administrator. Every failure -- no such account, no code, wrong code, locked
 * -- is the same 422 `recovery_failed`, and an unknown account costs the same
 * scrypt work as a real one, so the route reveals nothing about who exists.
 * Five wrong tries lock recovery for that account for an hour.
 *
 * On success the password is set, the used code is replaced by a new one --
 * returned once, to be written down -- and the reset is audited without the
 * password or either code.
 */
type Account = { authUserId: string; kind: 'farmer' | 'buyer'; entityId: string };

async function findAccount(identifier: string): Promise<Account | null> {
  let email: string;
  if (identifier.includes('@')) {
    email = identifier.trim().toLowerCase();
  } else {
    try {
      email = farmerAuthIdentifier(identifier);
    } catch {
      return null;
    }
  }
  const [row] = await prisma.$queryRawUnsafe<
    { auth_user_id: string; farmer_id: string | null; buyer_id: string | null }[]
  >(
    `SELECT u.id AS auth_user_id,
            (SELECT f.id FROM public.farmer f
              WHERE f.auth_user_id = u.id AND f.deleted_at IS NULL AND f.merged_into IS NULL) AS farmer_id,
            (SELECT b.id FROM public.buyer b
              WHERE b.auth_user_id = u.id AND b.deleted_at IS NULL) AS buyer_id
       FROM auth.users u
      WHERE lower(u.email) = $1
      LIMIT 1`,
    email,
  );
  if (!row) return null;
  if (row.farmer_id)
    return { authUserId: row.auth_user_id, kind: 'farmer', entityId: row.farmer_id };
  if (row.buyer_id) return { authUserId: row.auth_user_id, kind: 'buyer', entityId: row.buyer_id };
  return null;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: accountRecoverSchema,
    handler: async ({ body }) => {
      const account = await findAccount(body.identifier);
      if (!account) {
        await equaliseRecoveryTiming();
        throw unprocessable('recovery_failed');
      }

      // The password's own rule, now that we know whose account it is.
      const rule = account.kind === 'farmer' ? farmerPasswordSchema : passwordSchema;
      const parsed = rule.safeParse(body.new_password);
      if (!parsed.success) {
        throw new ApiFailure(400, 'invalid_input', 'Some of the information sent was not valid.', {
          new_password:
            parsed.error.issues[0]?.message ?? FARMER_ACCOUNT_MESSAGES.recoveryPasswordRequired,
        });
      }

      // Its own transaction: a wrong try must be counted even though the
      // request then fails.
      const check = await prisma.$transaction((tx) =>
        checkRecoveryCode(tx, account.authUserId, body.recovery_code),
      );
      if (check !== 'ok') throw unprocessable('recovery_failed');

      await setAuthPassword(account.authUserId, body.new_password);
      const newCode = await audited(prisma, async (tx) => {
        const code = await issueRecoveryCode(tx, account.authUserId);
        await writeAudit(tx, {
          entityType: account.kind,
          entityId: account.entityId,
          actorType: account.kind,
          actorId: account.entityId,
          action: account.kind === 'farmer' ? 'farmer.updated' : 'buyer.updated',
          after: { sign_in: 'password_reset_by_recovery_code' },
        });
        return code;
      });
      return ok({ account: account.kind, recovery_code: newCode });
    },
  },
});
