import { randomInt, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_LENGTH,
  formatRecoveryCode,
  normaliseRecoveryCode,
} from '@agri-erp/shared';

import type { AuditTx } from './audit';

/**
 * RECOVERY CODES (2026-10-09) -- the server half.
 *
 * A code is 12 characters from a 31-letter alphabet (about 59 bits), drawn with
 * crypto.randomInt. Only a salted scrypt hash is stored (account_recovery), so a
 * copy of the database does not reveal anyone's code. Checking compares in
 * constant time. Five wrong tries lock recovery for that account for an hour;
 * a right one clears the count. A used code is replaced at once.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const KEY_LENGTH = 32;
export const RECOVERY_MAX_ATTEMPTS = 5;
export const RECOVERY_LOCK_MINUTES = 60;

type Db = {
  $queryRawUnsafe: AuditTx['$queryRawUnsafe'];
  $executeRawUnsafe: AuditTx['$executeRawUnsafe'];
};

function newCode(): string {
  let out = '';
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i += 1) {
    out += RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)];
  }
  return out;
}

async function hashCode(code: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(normaliseRecoveryCode(code), salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function codeMatches(code: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(normaliseRecoveryCode(code), Buffer.from(saltHex, 'hex'), KEY_LENGTH);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Issues (or replaces) the recovery code of one sign-in account and returns it,
 * formatted for a person. The caller shows it ONCE; it is not kept anywhere.
 */
export async function issueRecoveryCode(db: Db, authUserId: string): Promise<string> {
  const code = newCode();
  await db.$executeRawUnsafe(
    `INSERT INTO public.account_recovery (auth_user_id, code_hash)
     VALUES ($1::uuid, $2)
     ON CONFLICT (auth_user_id) DO UPDATE SET
       code_hash = EXCLUDED.code_hash, failed_attempts = 0, locked_until = NULL,
       issued_at = now(), used_at = NULL`,
    authUserId,
    await hashCode(code),
  );
  return formatRecoveryCode(code);
}

export type RecoveryCheck = 'ok' | 'wrong' | 'locked' | 'none';

/**
 * Checks a code for one account and records the attempt. Locks the row for the
 * check, so two guesses cannot race past the attempt limit.
 */
export async function checkRecoveryCode(
  db: Db,
  authUserId: string,
  code: string,
): Promise<RecoveryCheck> {
  const [row] = await db.$queryRawUnsafe<
    { code_hash: string; failed_attempts: number; locked: boolean }[]
  >(
    `SELECT code_hash, failed_attempts,
            (locked_until IS NOT NULL AND locked_until > now()) AS locked
       FROM public.account_recovery WHERE auth_user_id = $1::uuid FOR UPDATE`,
    authUserId,
  );
  if (!row) return 'none';
  if (row.locked) return 'locked';
  if (await codeMatches(code, row.code_hash)) return 'ok';
  const attempts = row.failed_attempts + 1;
  if (attempts >= RECOVERY_MAX_ATTEMPTS) {
    // The fifth wrong try locks recovery for an hour and starts the count afresh.
    await db.$executeRawUnsafe(
      `UPDATE public.account_recovery
          SET failed_attempts = 0,
              locked_until = now() + make_interval(mins => $2::int)
        WHERE auth_user_id = $1::uuid`,
      authUserId,
      RECOVERY_LOCK_MINUTES,
    );
  } else {
    await db.$executeRawUnsafe(
      `UPDATE public.account_recovery SET failed_attempts = $2::smallint
        WHERE auth_user_id = $1::uuid`,
      authUserId,
      attempts,
    );
  }
  return 'wrong';
}

/**
 * The same scrypt work as a real check, for a request that names no account,
 * so the answer's timing does not tell a stranger whether the account exists.
 */
export async function equaliseRecoveryTiming(): Promise<void> {
  await scrypt('0'.repeat(RECOVERY_CODE_LENGTH), randomBytes(16), KEY_LENGTH);
}
