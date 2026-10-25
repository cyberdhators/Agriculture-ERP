import { accountSanctionSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { unprocessable } from '../../../../../lib/api/errors';
import {
  accountOf,
  reasonCodeLabel,
  sendSuspensionSms,
  standingOf,
  suspensionPhone,
} from '../../../../../lib/api/moderation';
import { requirePermission } from '../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';
import { disabledSmsText } from '../../../../../lib/suspension-sms';
import { disableAuthAccount, revokeAllSessions } from '../../../../../lib/supabase/admin';

/**
 * POST /api/admin/accounts/disable -- staff DISABLE an account (2026-10-28;
 * the specification, "Users and Organizations": "Contact, suspend, disable and
 * restore with reasons"). Administrators holding "Moderate content and
 * listings", with a reason (and optionally a reason code), as for a suspension.
 *
 * DISTINCT FROM SUSPEND. A suspension is lifted by any moderator with Restore;
 * a disable is permanent until a Super Admin re-enables it with a reason
 * (POST /api/admin/accounts/reenable), and Restore refuses it. A disabled
 * account is ALSO suspended -- the database requires it -- so every place that
 * already refuses a suspended account's sign-in and hides its posts does so
 * for a disabled one. An account already suspended may be disabled; its
 * suspension and reason stay as they were beneath the disable.
 *
 * In one transaction: disabled_at, the reason and who did it on the account's
 * farmer and buyer records (and suspended_* where not already set), one
 * account.disabled audit row per record, and one essential text message (the
 * reason CODE's label only, as a suspension sends). Then every session is
 * ended and the sign-in banned, exactly as on suspension; the answer says
 * whether each step was reached.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin'],
    bodySchema: accountSanctionSchema,
    handler: async ({ auth, body }) => {
      await requirePermission(auth, 'content.moderate');
      const done = await audited(prisma, async (tx) => {
        const found = await accountOf(tx, body.kind, body.id, true);
        if (found.disabledAt) throw unprocessable('account_already_disabled');
        const wasSuspended = found.suspendedAt !== null;
        const label = await reasonCodeLabel(tx, body.reason_code);
        for (const [table, id] of [
          ['farmer', found.farmerId],
          ['buyer', found.buyerId],
        ] as const) {
          if (!id) continue;
          await tx.$executeRawUnsafe(
            `UPDATE public.${table}
                SET disabled_at = now(), disabled_reason = $2, disabled_by = $3::uuid,
                    suspended_at = COALESCE(suspended_at, now()),
                    suspended_reason = COALESCE(suspended_reason, $2),
                    suspended_by = COALESCE(suspended_by, $3::uuid),
                    -- 2026-10-29: a disable is permanent; no end date survives it.
                    suspension_ends_at = NULL
              WHERE id = $1::uuid AND disabled_at IS NULL`,
            id,
            body.reason,
            auth.principal.id,
          );
        }
        const sms = await sendSuspensionSms(
          await suspensionPhone(tx, found),
          label,
          disabledSmsText,
        );
        for (const [table, id] of [
          ['farmer', found.farmerId],
          ['buyer', found.buyerId],
        ] as const) {
          if (!id) continue;
          await writeAudit(tx, {
            entityType: table,
            entityId: id,
            actorType: auth.role,
            actorId: auth.principal.id,
            action: 'account.disabled',
            before: { disabled: false, suspended: wasSuspended },
            after: {
              disabled: true,
              suspended: true,
              reason: body.reason,
              ...(body.reason_code ? { reason_code: body.reason_code } : {}),
              // What happened to the text message; never its text or the number.
              notice_sms: sms,
            },
          });
        }
        return { account: await accountOf(tx, body.kind, body.id), sms };
      });

      const { account, sms } = done;
      let sessionsEnded = account.authUserId === null;
      let signInBlocked = account.authUserId === null;
      if (account.authUserId) {
        try {
          await revokeAllSessions(account.authUserId);
          sessionsEnded = true;
        } catch {
          sessionsEnded = false;
        }
        try {
          await disableAuthAccount(account.authUserId);
          signInBlocked = true;
        } catch {
          signInBlocked = false;
        }
      }
      return ok({
        ...standingOf(account),
        sign_in_blocked: signInBlocked,
        sessions_ended: sessionsEnded,
        notice_sms: sms,
      });
    },
  },
});
