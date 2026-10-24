import {
  SETTING_DEFAULTS,
  parseSouthSudanMobile,
  type AccountStanding,
  type SanctionKind,
} from '@agri-erp/shared';

import { sendOneSms, smsConfig } from '../sms/bird';
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
}

/** The account behind one farmer or buyer record, with both its records. */
export async function accountOf(
  db: Db,
  kind: SanctionKind,
  id: string,
  lock = false,
): Promise<AccountRecords> {
  const [start] = await db.$queryRawUnsafe<
    { auth_user_id: string | null; suspended_at: Date | null; suspended_reason: string | null }[]
  >(
    kind === 'farmer'
      ? `SELECT auth_user_id, suspended_at, suspended_reason FROM public.farmer
          WHERE id = $1::uuid AND deleted_at IS NULL ${lock ? 'FOR UPDATE' : ''}`
      : `SELECT auth_user_id, suspended_at, suspended_reason FROM public.buyer
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
  };
}

export const standingOf = (account: AccountRecords): AccountStanding => ({
  suspended: account.suspendedAt !== null,
  suspended_at: account.suspendedAt?.toISOString() ?? null,
  reason: account.reason,
  has_sign_in: account.authUserId !== null,
});

// ---------------------------------------------------------------------------
// THE SUSPENSION TEXT MESSAGE (2026-10-26, CORWADO's acceptance test of 24
// October: "Suspend with reason/notification, review appeal and restore").
// docs/DECISIONS.md, "Notices for decisions, restores, new conversations and
// advice updates".
// ---------------------------------------------------------------------------

/** What happened to the one text message a suspension sends. Audited; never the text or the number. */
export type SuspensionSms = 'sent' | 'failed' | 'no_mobile';

/** The address the message names. The Contact CORWADO form is on the help page. */
export const APPEAL_ADDRESS = 'agrionesouthsudan.com/help';

/** Longest reason label that keeps the message inside one 160-character SMS. */
const LABEL_MAX = 39;

/**
 * The fixed text. It carries the reason CODE's label (one of CORWADO's list,
 * written by staff for this purpose), never the free-text reason, which may
 * name other people or hold notes meant for the file. With no code chosen, no
 * reason is named.
 */
export function suspensionSmsText(label: string | null): string {
  const named =
    label === null
      ? ''
      : ` Reason: ${label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 3)}...` : label}.`;
  return (
    `AgriOne: your account is suspended.${named} To appeal, visit ${APPEAL_ADDRESS} ` +
    `and choose 'Appeal a decision'.`
  );
}

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
  const [row] = await db.$queryRawUnsafe<{ farmer_phone: string | null; buyer_phone: string | null }[]>(
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
): Promise<SuspensionSms> {
  if (!phone) return 'no_mobile';
  try {
    const sent = await sendOneSms(smsConfig(), phone, suspensionSmsText(label));
    return sent.accepted ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
