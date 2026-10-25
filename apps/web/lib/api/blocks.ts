import { type AuditTx } from './audit';

/**
 * PERSON-LEVEL BLOCK (2026-10-28). docs/DECISIONS.md, "Person-level block".
 *
 * One account blocks another by sign-in (account_block). While EITHER of two
 * accounts has a live block against the other, neither can start a
 * conversation with the other nor send a message in one between them. Mutual
 * on purpose: the person who blocked unblocks first if they want to talk again.
 * The refusal never says which side blocked (conversation_account_blocked).
 *
 * An organisation's shared-inbox conversation is between the two PEOPLE the
 * conversation records (owner_auth_user_id, starter_auth_user_id): a block
 * between them stops it whichever colleague tries to write.
 */

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

export async function blockedBetween(db: Db, a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const [row] = await db.$queryRawUnsafe<{ blocked: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM public.account_block
        WHERE ended_at IS NULL
          AND ((blocker_auth_user_id = $1::uuid AND blocked_auth_user_id = $2::uuid)
            OR (blocker_auth_user_id = $2::uuid AND blocked_auth_user_id = $1::uuid))
     ) AS blocked`,
    a,
    b,
  );
  return row?.blocked === true;
}

export interface BlockRow {
  id: string;
  blocked_name: string;
  created_at: Date;
}

/** The only shape a block leaves in: never the other account's id. */
export const presentBlock = (row: BlockRow) => ({
  id: row.id,
  name: row.blocked_name,
  blocked_at: row.created_at.toISOString(),
});
