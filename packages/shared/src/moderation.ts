import { z } from 'zod';

import { BUYER_MESSAGES } from './buyer';
import { MARKET_POST_MESSAGES } from './market-posts';
import { reasonCodeSchema } from './settings';
import { STAFF_PERMISSION_MESSAGES } from './staff-permissions';

/**
 * SUSPEND AND RESTORE AN ACCOUNT (2026-10-21, CORWADO's 16 October
 * specification, "Reports and support"; the owner, 2026-10-20). Staff with
 * "Moderate content and listings" name the record they are looking at -- a
 * farmer or a buyer -- and give a reason, which is kept in the audit trail.
 * Every message here is one already pinned in docs/api/CONVENTIONS.md §5.2.3.
 */

export const SANCTION_KINDS = ['farmer', 'buyer'] as const;
export type SanctionKind = (typeof SANCTION_KINDS)[number];

export const accountSanctionSchema = z.strictObject({
  kind: z.enum(SANCTION_KINDS, { error: () => MARKET_POST_MESSAGES.posterUnknown }),
  id: z
    .string({ error: () => BUYER_MESSAGES.identifierMalformed })
    .uuid(BUYER_MESSAGES.identifierMalformed),
  reason: z
    .string({ error: () => STAFF_PERMISSION_MESSAGES.reasonRequired })
    .trim()
    .min(5, STAFF_PERMISSION_MESSAGES.reasonRequired)
    .max(500, STAFF_PERMISSION_MESSAGES.reasonTooLong),
  // 2026-10-25 (settings, phase 1): the reason code chosen from the list,
  // which pre-fills the reason. The written reason stays required.
  reason_code: reasonCodeSchema.optional(),
});
export type AccountSanctionInput = z.infer<typeof accountSanctionSchema>;

/**
 * 2026-10-29 (CORWADO's Settings line "reason codes, suspension duration and
 * appeals"): a suspension MAY carry a duration in whole days. Without one it
 * has no end and lasts until staff restore it, as before. With one, it ends
 * at the start of that day in Juba (suspensionEndsAt), and the daily job
 * lifts it (POST /api/cron/expiry-reminders). The day count is staff's
 * choice; the person and staff are both shown the end date.
 */
export const SUSPENSION_DAYS_MAX = 365;

export const SUSPENSION_MESSAGES = {
  daysInvalid: 'Choose a number of days from 1 to 365, or leave it empty for no end date.',
} as const;

export const accountSuspendSchema = accountSanctionSchema.extend({
  suspend_days: z
    .number({ error: () => SUSPENSION_MESSAGES.daysInvalid })
    .int(SUSPENSION_MESSAGES.daysInvalid)
    .min(1, SUSPENSION_MESSAGES.daysInvalid)
    .max(SUSPENSION_DAYS_MAX, SUSPENSION_MESSAGES.daysInvalid)
    .nullable()
    .optional(),
});
export type AccountSuspendInput = z.infer<typeof accountSuspendSchema>;

/** Juba keeps UTC+2 all year (no daylight saving). */
const JUBA_OFFSET_MS = 2 * 60 * 60 * 1000;

/**
 * When a suspension of `days` days made at `now` ends: midnight in Juba
 * after `days` FULL days have passed (the rest of today does not count, so
 * a suspension is never shorter than asked -- the owner, 2026-10-29).
 * Suspended on 5 November for 7 days, the account is back on 13 November;
 * for 1 day, back the day after tomorrow. Null days, no end.
 */
export function suspensionEndsAt(now: Date, days: number | null | undefined): Date | null {
  if (days === null || days === undefined) return null;
  const juba = new Date(now.getTime() + JUBA_OFFSET_MS);
  const startOfJubaDay = Date.UTC(juba.getUTCFullYear(), juba.getUTCMonth(), juba.getUTCDate());
  return new Date(startOfJubaDay + (days + 1) * 86_400_000 - JUBA_OFFSET_MS);
}

/**
 * Whether a suspension has ended by itself and may be lifted by the daily
 * job: suspended, NOT disabled (a disable never ends by itself), with an end
 * that has passed. A suspension with no end never has.
 */
export function suspensionHasEnded(
  account: { suspendedAt: Date | null; disabledAt: Date | null; suspensionEnds: Date | null },
  now: Date,
): boolean {
  return (
    account.suspendedAt !== null &&
    account.disabledAt === null &&
    account.suspensionEnds !== null &&
    account.suspensionEnds.getTime() <= now.getTime()
  );
}

/** The end date as the person reads it, in Juba: "2026-11-12". */
export function suspensionEndDate(endsAt: Date): string {
  return new Date(endsAt.getTime() + JUBA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Where an account stands, as the staff screens show it. */
export interface AccountStanding {
  suspended: boolean;
  suspended_at: string | null;
  reason: string | null;
  /** Whether the account can sign in at all (an officer-registered farmer may have no sign-in). */
  has_sign_in: boolean;
  /**
   * 2026-10-28: DISABLED -- a permanent stop, distinct from a suspension (a
   * disabled account is also suspended). Only a Super Admin lifts it, with a
   * reason; Restore refuses it.
   */
  disabled: boolean;
  disabled_at: string | null;
  disabled_reason: string | null;
  /**
   * 2026-10-29: when a suspension with a duration ends (the daily job lifts
   * it then); null for one with no end. Absent from older answers.
   */
  suspension_ends_at?: string | null;
  /**
   * 2026-10-28: the account's ADVISORY authorization, shown beside its
   * standing and decided separately (the approved-adviser pathway). Absent
   * from older answers.
   */
  advisory?: {
    status: string;
    application_id: string | null;
    suspended_until: string | null;
    decided_at: string | null;
  };
}
