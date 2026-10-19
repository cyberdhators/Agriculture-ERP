import { type AccountStanding, type SanctionKind } from '@agri-erp/shared';

import { type AuditTx } from './audit';
import { notFound } from './errors';

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
