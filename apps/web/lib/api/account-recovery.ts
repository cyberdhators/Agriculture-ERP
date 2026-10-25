import { numberChangedSmsText, parseSouthSudanMobile } from '@agri-erp/shared';

import { prisma } from '../db';
import { sendOneSms, smsConfig } from '../sms/bird';

/**
 * SELF-SERVICE RECOVERY AND A VERIFIED CHANGE OF NUMBER (2026-10-27), server
 * side. docs/DECISIONS.md, "Self-service password recovery and a verified
 * change of number". The codes themselves are lib/api/phone-verification.ts.
 */

/** The language an SMS is written in: Arabic when the request asks for it, else English. */
export const smsLanguage = (request: Request): 'en' | 'ar' =>
  (request.headers.get('accept-language') ?? '').toLowerCase().startsWith('ar') ? 'ar' : 'en';

/** The phone account a number signs in to, if any: a live, unmerged, unsuspended farmer with a sign-in. */
export interface RecoverableAccount {
  farmerId: string;
  authUserId: string;
}

/**
 * Looked up on the server and NEVER reported to the caller: the recovery
 * route answers the same whether this returns an account or null.
 */
export async function recoverableAccount(phone: string): Promise<RecoverableAccount | null> {
  const [row] = await prisma.$queryRawUnsafe<{ id: string; auth_user_id: string }[]>(
    `SELECT id, auth_user_id FROM public.farmer_active
      WHERE phone = $1 AND auth_user_id IS NOT NULL AND merged_into IS NULL
        AND suspended_at IS NULL
      ORDER BY created_at LIMIT 1`,
    phone,
  );
  return row ? { farmerId: row.id, authUserId: row.auth_user_id } : null;
}

/** What happened to the "your number was changed" message. Audited; never the text or the number. */
export type OldNumberSms = 'sent' | 'failed' | 'not_mobile';

/**
 * Tells the OLD number that the account's number changed, so a holder who did
 * not ask for it can act. An essential service message. NEVER THROWS: the
 * change has already been made, and a message that cannot go is 'failed'.
 */
export async function sendNumberChangedSms(
  oldPhone: string,
  language: 'en' | 'ar',
): Promise<OldNumberSms> {
  const parsed = parseSouthSudanMobile(oldPhone);
  if (!parsed.ok) return 'not_mobile';
  try {
    const sent = await sendOneSms(smsConfig(), parsed.value, numberChangedSmsText(language));
    return sent.accepted ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
