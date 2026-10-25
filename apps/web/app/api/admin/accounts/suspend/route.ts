import { accountSuspendSchema, suspensionEndDate, suspensionEndsAt } from '@agri-erp/shared';

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
import { disableAuthAccount, revokeAllSessions } from '../../../../../lib/supabase/admin';
import { suspensionSmsText } from '../../../../../lib/suspension-sms';

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
 * THE ACCOUNT IS TOLD (2026-10-26, CORWADO's acceptance test). Inside the
 * transaction, after the records change and before the audit rows are
 * written, ONE essential text message goes to the account's South Sudan
 * mobile (the farmer record's phone, else the buyer's): it is suspended, the
 * reason CODE's label (never the free-text reason), and how to appeal. Its
 * outcome -- sent, failed, or no mobile -- is in each account.suspended audit
 * row, never its text or the number. A message that cannot be sent never
 * fails the suspension; the answer says so (notice_sms), as it says whether
 * the sign-in was reached. Sending inside the transaction is deliberate: the
 * outcome belongs in the suspension's own audit row, and nothing that can
 * refuse comes after the send except those inserts.
 *
 * Then EVERY EXISTING SESSION IS ENDED (revokeAllSessions -- the acceptance
 * test saw a session from before the suspension work again after restore),
 * and the sign-in is banned so no new one can start. Sessions are ended
 * first: ending them mints a one-time sign-in, which a banned account could
 * not redeem. If Supabase does not answer, the suspension already holds (every
 * request is refused by requireRole); the answer says which step did not
 * (sessions_ended, sign_in_blocked).
 *
 * 2026-10-29: an optional DURATION (suspend_days, 1 to 365). Without it the
 * suspension has no end, as before. With it, suspension_ends_at is set to the
 * start of the end day in Juba, the text message names that date, and the
 * daily job (POST /api/cron/expiry-reminders) lifts it then.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: accountSuspendSchema,
    handler: async ({ auth, body }) => {
      await requirePermission(auth, 'content.moderate');
      const done = await audited(prisma, async (tx) => {
        const found = await accountOf(tx, body.kind, body.id, true);
        if (found.suspendedAt) throw unprocessable('account_already_suspended');
        const label = await reasonCodeLabel(tx, body.reason_code);
        const until = suspensionEndsAt(new Date(), body.suspend_days);
        for (const [table, id] of [
          ['farmer', found.farmerId],
          ['buyer', found.buyerId],
        ] as const) {
          if (!id) continue;
          await tx.$executeRawUnsafe(
            `UPDATE public.${table}
                SET suspended_at = now(), suspended_reason = $2, suspended_by = $3::uuid,
                    suspension_ends_at = $4::timestamptz
              WHERE id = $1::uuid AND suspended_at IS NULL`,
            id,
            body.reason,
            auth.principal.id,
            until,
          );
        }
        const endDate = until ? suspensionEndDate(until) : null;
        const sms = await sendSuspensionSms(await suspensionPhone(tx, found), label, (l) =>
          suspensionSmsText(l, endDate),
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
            action: 'account.suspended',
            before: { suspended: false },
            after: {
              suspended: true,
              reason: body.reason,
              // 2026-10-25: the reason code chosen from the list, if any.
              ...(body.reason_code ? { reason_code: body.reason_code } : {}),
              // 2026-10-29: when it ends by itself; null for no end.
              suspension_ends_at: until?.toISOString() ?? null,
              // 2026-10-26: what happened to the text message; never its text or the number.
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
