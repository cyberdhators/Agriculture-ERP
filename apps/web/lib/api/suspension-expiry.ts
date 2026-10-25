import type { SanctionKind } from '@agri-erp/shared';

import { prisma } from '../db';
import { disableAuthAccount, enableAuthAccount } from '../supabase/admin';
import { audited, writeAudit } from './audit';
import { accountOf } from './moderation';
import { notifyAccount } from './notify';

/**
 * SUSPENSIONS THAT END BY THEMSELVES (2026-10-29, CORWADO's Settings line
 * "reason codes, suspension duration and appeals"). docs/DECISIONS.md, "A
 * suspension may end by itself".
 *
 * Once a day (POST /api/cron/expiry-reminders): every account whose
 * suspension carries an end (suspended_until) that has passed is restored,
 * exactly as staff restore one -- both of its records cleared, one audit row
 * per record (`account.suspension_expired`, actor 'system'), one fixed in-app
 * notice ('suspension_ended'), and the sign-in ban lifted.
 *
 * NEVER A DISABLED ACCOUNT: a disable is permanent until a Super Admin lifts
 * it (the database also refuses an end date on a disabled record). A
 * suspension with no end is never touched.
 *
 * ORDER, so a half-done lift is always the safe half: the sign-in ban is
 * lifted FIRST. While the records still say suspended, every request is
 * refused anyway (requireRole), so an unbanned sign-in on its own opens
 * nothing. Only when that succeeded are the records cleared; if the
 * authentication service did not answer, nothing is cleared and the next run
 * tries again. Idempotent and safe to run twice at once: each account is
 * re-read under a row lock and lifted only if its end has still passed; one
 * that changed meanwhile has its sign-in ban put back if it is still
 * suspended.
 */

/** Accounts lifted per run; the rest wait for the next. */
export const SUSPENSION_LIFT_BATCH = 200;

export interface SuspensionLiftOutcome {
  due: number;
  lifted: number;
  /** The sign-in service did not answer; left suspended for the next run. */
  sign_in_not_reached: number;
  /** Changed since it was read (restored, disabled or extended): left alone. */
  skipped: number;
  failed: number;
}

/** Records whose end has passed, one per account. Read as text by the scan test. */
export const DUE_SUSPENSIONS_SQL = `
  SELECT DISTINCT ON (account) kind, id, auth_user_id FROM (
    SELECT 'farmer'::text AS kind, f.id, f.auth_user_id,
           COALESCE(f.auth_user_id::text, f.id::text) AS account, f.suspended_until
      FROM public.farmer f
     WHERE f.suspended_until IS NOT NULL AND f.suspended_until <= now()
       AND f.suspended_at IS NOT NULL AND f.disabled_at IS NULL AND f.deleted_at IS NULL
    UNION ALL
    SELECT 'buyer'::text, b.id, b.auth_user_id,
           COALESCE(b.auth_user_id::text, b.id::text), b.suspended_until
      FROM public.buyer b
     WHERE b.suspended_until IS NOT NULL AND b.suspended_until <= now()
       AND b.suspended_at IS NOT NULL AND b.disabled_at IS NULL AND b.deleted_at IS NULL
  ) due
  ORDER BY account, suspended_until
  LIMIT ${SUSPENSION_LIFT_BATCH}`;

/** Whether a record read under lock is still due: suspended, not disabled, its end passed. */
export function stillDue(
  account: { suspendedAt: Date | null; disabledAt: Date | null; suspendedUntil: Date | null },
  now: Date,
): boolean {
  return (
    account.suspendedAt !== null &&
    account.disabledAt === null &&
    account.suspendedUntil !== null &&
    account.suspendedUntil.getTime() <= now.getTime()
  );
}

async function rebanIfStillSuspended(
  kind: SanctionKind,
  id: string,
  authUserId: string,
): Promise<void> {
  const found = await accountOf(prisma, kind, id).catch(() => null);
  if (found?.suspendedAt) await disableAuthAccount(authUserId).catch(() => undefined);
}

export async function liftExpiredSuspensions(): Promise<SuspensionLiftOutcome> {
  const rows = await prisma.$queryRawUnsafe<
    { kind: SanctionKind; id: string; auth_user_id: string | null }[]
  >(DUE_SUSPENSIONS_SQL);
  const outcome: SuspensionLiftOutcome = {
    due: rows.length,
    lifted: 0,
    sign_in_not_reached: 0,
    skipped: 0,
    failed: 0,
  };
  const system = { actorType: 'system', actorId: null } as const;

  for (const row of rows) {
    try {
      // 1. The sign-in first: harmless while the records still say suspended.
      if (row.auth_user_id) {
        try {
          await enableAuthAccount(row.auth_user_id);
        } catch {
          outcome.sign_in_not_reached += 1;
          continue;
        }
      }
      // 2. The records, under lock, re-checked; one transaction per account.
      const lifted = await audited(prisma, async (tx) => {
        const found = await accountOf(tx, row.kind, row.id, true);
        if (!stillDue(found, new Date())) return false;
        for (const [table, id] of [
          ['farmer', found.farmerId],
          ['buyer', found.buyerId],
        ] as const) {
          if (!id) continue;
          const changed = await tx.$executeRawUnsafe(
            `UPDATE public.${table}
                SET suspended_at = NULL, suspended_reason = NULL, suspended_by = NULL,
                    suspended_until = NULL
              WHERE id = $1::uuid AND suspended_at IS NOT NULL AND disabled_at IS NULL`,
            id,
          );
          if (changed === 0) continue;
          await writeAudit(tx, {
            entityType: table,
            entityId: id,
            ...system,
            action: 'account.suspension_expired',
            before: { suspended: true, suspended_until: found.suspendedUntil?.toISOString() },
            after: { suspended: false },
          });
        }
        await notifyAccount(
          tx,
          { authUserId: found.authUserId, farmerId: found.farmerId },
          'suspension_ended',
          system,
        );
        return true;
      });
      if (lifted) {
        outcome.lifted += 1;
      } else {
        outcome.skipped += 1;
        // Restored, disabled or extended since it was read: the ban goes back
        // on if the account is still suspended (a restore already lifted it).
        if (row.auth_user_id) await rebanIfStillSuspended(row.kind, row.id, row.auth_user_id);
      }
    } catch {
      outcome.failed += 1;
    }
  }
  return outcome;
}
