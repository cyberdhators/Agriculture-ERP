import { z } from 'zod';

import { BUYER_MESSAGES } from './buyer';
import { MARKET_POST_MESSAGES } from './market-posts';
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
});
export type AccountSanctionInput = z.infer<typeof accountSanctionSchema>;

/** Where an account stands, as the staff screens show it. */
export interface AccountStanding {
  suspended: boolean;
  suspended_at: string | null;
  reason: string | null;
  /** Whether the account can sign in at all (an officer-registered farmer may have no sign-in). */
  has_sign_in: boolean;
}
