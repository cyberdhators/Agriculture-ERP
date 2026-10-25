import { recoveryResetSchema } from '@agri-erp/shared';

import { recoverableAccount } from '../../../../../lib/api/account-recovery';
import { audited, writeAudit } from '../../../../../lib/api/audit';
import { authUnavailable, unprocessable } from '../../../../../lib/api/errors';
import { notifyAccount } from '../../../../../lib/api/notify';
import {
  consumeVerification,
  releaseVerification,
} from '../../../../../lib/api/phone-verification';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';
import { revokeAllSessions, setAuthPassword } from '../../../../../lib/supabase/admin';

/**
 * POST /api/auth/recovery/reset -- set a new password with a verified
 * recovery code (2026-10-27). PUBLIC: the person cannot sign in.
 *
 *   1. The code is used up (one code, one reset), atomically, so two
 *      requests with the same code cannot both proceed.
 *   2. The number's account gets the new password (Supabase Auth; the
 *      password is never stored, logged or audited here).
 *   3. EVERY EXISTING SESSION IS ENDED (revokeAllSessions), so a phone or
 *      browser someone else holds is signed out. The person then signs in
 *      with the new password.
 *   4. One audit row (`account.password_recovered`, with whether the sessions
 *      were ended) and one fixed in-app notice, in one transaction.
 *
 * If the password cannot be set, the code is given back so the person can try
 * again without a new SMS. Only someone who received the SMS can reach step
 * 2, so naming a failure here reveals nothing about who has an account.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: recoveryResetSchema,
    handler: async ({ body }) => {
      const phone = await consumeVerification(prisma, body.verification_id, 'password_recovery');
      const account = await recoverableAccount(phone);
      if (!account) throw unprocessable('phone_not_verified');

      try {
        await setAuthPassword(account.authUserId, body.password);
      } catch {
        await releaseVerification(body.verification_id);
        throw authUnavailable();
      }

      let sessionsEnded = true;
      try {
        await revokeAllSessions(account.authUserId);
      } catch {
        sessionsEnded = false;
      }

      const actor = { actorType: 'farmer', actorId: account.farmerId } as const;
      await audited(prisma, async (tx) => {
        await writeAudit(tx, {
          entityType: 'farmer',
          entityId: account.farmerId,
          ...actor,
          action: 'account.password_recovered',
          // How, and whether every other session was ended. Never the password or the number.
          after: { method: 'sms_code', sessions_ended: sessionsEnded },
        });
        await notifyAccount(
          tx,
          { authUserId: account.authUserId, farmerId: account.farmerId },
          'password_recovered',
          actor,
        );
      });
      return ok({ password_set: true, sessions_ended: sessionsEnded });
    },
  },
});
