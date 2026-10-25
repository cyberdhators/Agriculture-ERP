import {
  SETTING_DEFAULTS,
  parseSouthSudanMobile,
  type AccountStanding,
  type SanctionKind,
} from '@agri-erp/shared';

import { sendOneSms, smsConfig } from '../sms/bird';
import { suspensionSmsText } from '../suspension-sms';
import { type AuditTx } from './audit';
import { notFound } from './errors';
import { currentSetting, settingsTablesPresent } from './settings';

/**
 * SUSPEND AND RESTORE (2026-10-21). docs/DECISIONS.md, "Staff suspend and
 * restore an account".
 *
 * A suspension is the ACCOUNT's: one sign-in may hold a farmer and a buyer
 * record (#178), so suspending either suspends both, and restoring either
 * restores both. A farmer registered by an officer with no sign-in is just
 * that one record. Removed (soft-deleted) records are out of reach: they are
 * neither suspended nor restored here.
 */

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

export interface AccountRecords {
  authUserId: string | null;
  farmerId: string | null;
  buyerId: string | null;
  suspendedAt: Date | null;
  reason: string | null;
  /** 2026-10-28: disabled (permanent; a Super Admin lifts it). Disabled is also suspended. */
  disabledAt: Date | null;
  disabledReason: string | null;
  /** 2026-10-29: when a suspension with a duration ends; null for none. */
  suspensionEnds: Date | null;
}

/** The account behind one farmer or buyer record, with both its records. */
export async function accountOf(
  db: Db,
  kind: SanctionKind,
  id: string,
  lock = false,
): Promise<AccountRecords> {
  const [start] = await db.$queryRawUnsafe<
    {
      auth_user_id: string | null;
      suspended_at: Date | null;
      suspended_reason: string | null;
      disabled_at: Date | null;
      disabled_reason: string | null;
      suspension_ends_at: Date | null;
    }[]
  >(
    kind === 'farmer'
      ? `SELECT auth_user_id, suspended_at, suspended_reason, disabled_at, disabled_reason,
                suspension_ends_at
           FROM public.farmer
          WHERE id = $1::uuid AND deleted_at IS NULL ${lock ? 'FOR UPDATE' : ''}`
      : `SELECT auth_user_id, suspended_at, suspended_reason, disabled_at, disabled_reason,
                suspension_ends_at
           FROM public.buyer
          WHERE id = $1::uuid AND deleted_at IS NULL ${lock ? 'FOR UPDATE' : ''}`,
    id,
  );
  if (!start) throw notFound();
  let farmerId = kind === 'farmer' ? id : null;
  let buyerId = kind === 'buyer' ? id : null;
  if (start.auth_user_id) {
    const [other] = await db.$queryRawUnsafe<{ id: string }[]>(
      kind === 'farmer'
        ? `SELECT id FROM public.buyer WHERE auth_user_id = $1::uuid AND deleted_at IS NULL
            ${lock ? 'FOR UPDATE' : ''}`
        : `SELECT id FROM public.farmer WHERE auth_user_id = $1::uuid AND deleted_at IS NULL
            ${lock ? 'FOR UPDATE' : ''}`,
      start.auth_user_id,
    );
    if (kind === 'farmer') buyerId = other?.id ?? null;
    else farmerId = other?.id ?? null;
  }
  return {
    authUserId: start.auth_user_id,
    farmerId,
    buyerId,
    suspendedAt: start.suspended_at,
    reason: start.suspended_reason,
    disabledAt: start.disabled_at,
    disabledReason: start.disabled_reason,
    suspensionEnds: start.suspension_ends_at,
  };
}

export const standingOf = (account: AccountRecords): AccountStanding => ({
  suspended: account.suspendedAt !== null,
  suspended_at: account.suspendedAt?.toISOString() ?? null,
  reason: account.reason,
  has_sign_in: account.authUserId !== null,
  disabled: account.disabledAt !== null,
  disabled_at: account.disabledAt?.toISOString() ?? null,
  disabled_reason: account.disabledReason,
  suspension_ends_at: account.suspensionEnds?.toISOString() ?? null,
});

// ---------------------------------------------------------------------------
// THE SUSPENSION TEXT MESSAGE (2026-10-26, CORWADO's acceptance test of 24
// October: "Suspend with reason/notification, review appeal and restore").
// docs/DECISIONS.md, "Notices for decisions, restores, new conversations and
// advice updates".
// ---------------------------------------------------------------------------

/** What happened to the one text message a suspension sends. Audited; never the text or the number. */
export type SuspensionSms = 'sent' | 'failed' | 'no_mobile';

/** The label of a reason code -- archived codes included, since a decision may name one. */
export async function reasonCodeLabel(db: Db, code: string | undefined): Promise<string | null> {
  if (!code) return null;
  const setting = (await settingsTablesPresent(db))
    ? (await currentSetting('reason_codes', db)).value
    : SETTING_DEFAULTS.reason_codes;
  return setting.codes.find((c) => c.code === code)?.label ?? null;
}

/**
 * The account's mobile for the message: the farmer record's phone, else the
 * buyer's, and only when it is a South Sudan mobile (+211). Never returned to
 * a screen, never audited.
 */
export async function suspensionPhone(db: Db, account: AccountRecords): Promise<string | null> {
  const [row] = await db.$queryRawUnsafe<
    { farmer_phone: string | null; buyer_phone: string | null }[]
  >(
    `SELECT (SELECT phone FROM public.farmer WHERE id = $1::uuid) AS farmer_phone,
            (SELECT phone FROM public.buyer WHERE id = $2::uuid) AS buyer_phone`,
    account.farmerId,
    account.buyerId,
  );
  for (const phone of [row?.farmer_phone, row?.buyer_phone]) {
    if (!phone) continue;
    const parsed = parseSouthSudanMobile(phone);
    if (parsed.ok) return parsed.value;
  }
  return null;
}

/**
 * Sends the ONE essential message a suspension sends, through the existing
 * Bird client. An essential service message: no marketing preference stops
 * it. NEVER THROWS -- an SMS that cannot be sent (no configuration, Bird down,
 * refused) is 'failed', and the suspension stands regardless.
 */
export async function sendSuspensionSms(
  phone: string | null,
  label: string | null,
  // 2026-10-28: a disable sends the same shape of message, saying "disabled".
  text: (label: string | null) => string = suspensionSmsText,
): Promise<SuspensionSms> {
  if (!phone) return 'no_mobile';
  try {
    const sent = await sendOneSms(smsConfig(), phone, text(label));
    return sent.accepted ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
