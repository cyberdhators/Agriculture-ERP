import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { after } from 'next/server';

import { PHONE_CODE, phoneCodeSmsText, type PhoneCodePurpose } from '@agri-erp/shared';

import { type AuditTx } from './audit';
import { ApiFailure, unprocessable } from './errors';
import { cachedSettingValue } from './settings';
import { prisma } from '../db';
import {
  SmsNotConfiguredError,
  SmsUnavailableError,
  sendOneSms,
  smsConfig,
  smsIsConfigured,
} from '../sms/bird';

/**
 * PHONE VERIFICATION BY SMS CODE (2026-10-19), server side.
 *
 * A code is 6 random digits, sent by Bird with CORWADO's sender, stored only
 * as a hash bound to its own row id, good for 10 minutes and 5 tries. Sending
 * is limited per phone and system-wide, so nobody can run up the SMS bill.
 *
 * ON BY DEFAULT WHEN SMS IS CONFIGURED. `FARMER_PHONE_VERIFICATION=off` turns
 * it off -- the switch for the day a network turns out not to deliver codes,
 * so sign-up never depends on an SMS nobody receives. Without Bird settings
 * there is nothing to send with, so sign-up works without a code, as before.
 */
export function phoneVerificationRequired(): boolean {
  if ((process.env.FARMER_PHONE_VERIFICATION ?? '').toLowerCase() === 'off') return false;
  return smsIsConfigured();
}

const hashCode = (id: string, code: string): string =>
  createHash('sha256').update(`${id}:${code}`).digest('hex');

const tooMany = (message: string, retryAfterSeconds?: number) =>
  new ApiFailure(
    429,
    'phone_code_rate_limited',
    message,
    undefined,
    retryAfterSeconds ? { 'retry-after': String(retryAfterSeconds) } : undefined,
  );

/**
 * 2026-10-27: how a code is issued, for each purpose. Sign-up sends at once
 * and reports a failed send (503), as it always has. Recovery and change of
 * number may DEFER the send until after the answer has gone (`after` from
 * next/server), so the answer takes the same time whether or not a message is
 * sent -- recovery answers the same for every number, account or none.
 */
export interface IssueOptions {
  purpose: PhoneCodePurpose;
  /** The account a change-of-number code is for. Required for phone_change, else absent. */
  authUserId?: string | null;
  /** False: write the row (so limits and the answer are the same) but send nothing. */
  deliver?: boolean;
  /** True: send after the answer; a failed send just spends the row. */
  defer?: boolean;
}

/** Runs `task` after the response when the runtime allows it; otherwise in the background. */
function afterResponse(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    // Outside a request (a script, a test): run it without waiting.
    void task().catch(() => undefined);
  }
}

/** Issue a code for this phone and purpose. Returns the verification id and expiry. */
export async function issuePhoneCode(
  phone: string,
  language: 'en' | 'ar',
  options: IssueOptions,
): Promise<{ id: string; expiresAt: Date }> {
  const deliver = options.deliver ?? true;
  let config: ReturnType<typeof smsConfig>;
  try {
    config = smsConfig();
  } catch (failure) {
    if (failure instanceof SmsNotConfiguredError) {
      throw new ApiFailure(503, 'sms_not_configured', 'Codes cannot be sent just now.');
    }
    throw failure;
  }

  const [counts] = await prisma.$queryRawUnsafe<
    { phone_recent: number; phone_last_s: number | null; system_hour: number }[]
  >(
    `SELECT
       count(*) FILTER (WHERE phone = $1 AND created_at > now() - make_interval(mins => $2))::int
         AS phone_recent,
       EXTRACT(EPOCH FROM now() - max(created_at) FILTER (WHERE phone = $1))::int AS phone_last_s,
       count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS system_hour
     FROM public.phone_verification
     WHERE created_at > now() - interval '1 hour' OR phone = $1`,
    phone,
    PHONE_CODE.windowMinutes,
  );
  // 2026-10-27 (settings phase 2): the wait is Registration and recovery's
  // setting; 60 seconds, as before, until one is saved.
  const resendSeconds = (await cachedSettingValue('registration_recovery')).code_resend_seconds;
  if (counts && counts.phone_last_s !== null && counts.phone_last_s < resendSeconds) {
    const wait = resendSeconds - counts.phone_last_s;
    throw tooMany(`Please wait ${wait} seconds before asking for another code.`, wait);
  }
  if (counts && counts.phone_recent >= PHONE_CODE.perPhone) {
    throw tooMany(
      `Too many codes for this number. Try again in ${PHONE_CODE.windowMinutes} minutes.`,
      PHONE_CODE.windowMinutes * 60,
    );
  }
  if (counts && counts.system_hour >= PHONE_CODE.perHourSystem) {
    throw tooMany('Codes are busy just now. Please try again later.', 600);
  }

  const code = String(randomInt(0, 10 ** PHONE_CODE.length)).padStart(PHONE_CODE.length, '0');
  const [row] = await prisma.$queryRawUnsafe<{ id: string; expires_at: Date }[]>(
    `INSERT INTO public.phone_verification (phone, purpose, code_hash, expires_at, auth_user_id)
     VALUES ($1, $3, 'pending', now() + make_interval(mins => $2), $4::uuid)
     RETURNING id, expires_at`,
    phone,
    PHONE_CODE.ttlMinutes,
    options.purpose,
    options.authUserId ?? null,
  );
  await prisma.$executeRawUnsafe(
    'UPDATE public.phone_verification SET code_hash = $2 WHERE id = $1::uuid',
    row!.id,
    hashCode(row!.id, code),
  );

  if (!deliver) return { id: row!.id, expiresAt: row!.expires_at };

  const text = phoneCodeSmsText(code, options.purpose, language);
  const send = async (): Promise<boolean> => {
    try {
      const sent = await sendOneSms(config, phone, text);
      if (!sent.accepted) throw new SmsUnavailableError();
      return true;
    } catch {
      // Not sent: the row is spent so it cannot be verified.
      await prisma
        .$executeRawUnsafe(
          `UPDATE public.phone_verification SET expires_at = now() WHERE id = $1::uuid`,
          row!.id,
        )
        .catch(() => undefined);
      return false;
    }
  };

  if (options.defer) {
    afterResponse(async () => {
      await send();
    });
    return { id: row!.id, expiresAt: row!.expires_at };
  }
  if (!(await send())) {
    // The farmer is told plainly rather than left waiting for an SMS that will not come.
    throw new ApiFailure(
      503,
      'sms_unavailable',
      'The code could not be sent just now. Please try again in a few minutes.',
    );
  }
  return { id: row!.id, expiresAt: row!.expires_at };
}

/** Send a sign-up code to this phone. Returns the verification id and expiry. */
export function sendSignUpCode(
  phone: string,
  language: 'en' | 'ar',
): Promise<{ id: string; expiresAt: Date }> {
  return issuePhoneCode(phone, language, { purpose: 'farmer_sign_up' });
}

/**
 * Check a typed code. Marks the verification verified on success. Since
 * 2026-10-27 the code must be of the purpose asked about (and, for a change of
 * number, issued to the same account): a sign-up code cannot be verified as a
 * recovery code or the reverse.
 */
export async function verifyPhoneCode(
  id: string,
  code: string,
  purpose: PhoneCodePurpose,
  authUserId: string | null = null,
): Promise<void> {
  // One try is counted before the comparison, atomically, so parallel guesses
  // cannot exceed the limit.
  const [row] = await prisma.$queryRawUnsafe<
    { code_hash: string; attempts: number; expired: boolean; verified: boolean }[]
  >(
    `UPDATE public.phone_verification SET attempts = attempts + 1
      WHERE id = $1::uuid AND consumed_at IS NULL AND purpose = $2
        AND auth_user_id IS NOT DISTINCT FROM $3::uuid
      RETURNING code_hash, attempts, (expires_at < now()) AS expired,
                (verified_at IS NOT NULL) AS verified`,
    id,
    purpose,
    authUserId,
  );
  if (!row || row.expired) throw unprocessable('phone_code_expired');
  if (row.verified) return;
  if (row.attempts > PHONE_CODE.maxAttempts) throw unprocessable('phone_code_too_many_tries');
  const expected = Buffer.from(row.code_hash, 'hex');
  const given = Buffer.from(hashCode(id, code), 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw unprocessable('phone_code_wrong');
  }
  await prisma.$executeRawUnsafe(
    'UPDATE public.phone_verification SET verified_at = now() WHERE id = $1::uuid',
    id,
  );
}

/** Check the code the farmer typed at sign-up. */
export function verifySignUpCode(id: string, code: string): Promise<void> {
  return verifyPhoneCode(id, code, 'farmer_sign_up');
}

/**
 * Inside the sign-up transaction: the verification must be this phone's,
 * verified, recent and not used before. It is used up here, so one code makes
 * one account.
 */
export async function consumeSignUpVerification(
  tx: AuditTx,
  id: string | undefined,
  phone: string,
): Promise<void> {
  if (!id) throw unprocessable('phone_not_verified');
  const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
    `UPDATE public.phone_verification SET consumed_at = now()
      WHERE id = $1::uuid AND phone = $2 AND purpose = 'farmer_sign_up'
        AND verified_at IS NOT NULL AND consumed_at IS NULL
        AND verified_at > now() - make_interval(mins => $3)
      RETURNING id`,
    id,
    phone,
    PHONE_CODE.useWithinMinutes,
  );
  if (!row) throw unprocessable('phone_not_verified');
}

/**
 * 2026-10-27. Uses up a verified code of one purpose inside the caller's
 * transaction and returns its phone, or throws phone_not_verified. A recovery
 * code is matched by id alone (the number is the row's); a change-of-number
 * code must be for this new number AND this account.
 */
export async function consumeVerification(
  tx: { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] },
  id: string | undefined,
  purpose: Exclude<PhoneCodePurpose, 'farmer_sign_up'>,
  match: { phone?: string; authUserId?: string } = {},
): Promise<string> {
  if (!id) throw unprocessable('phone_not_verified');
  const [row] = await tx.$queryRawUnsafe<{ phone: string }[]>(
    `UPDATE public.phone_verification SET consumed_at = now()
      WHERE id = $1::uuid AND purpose = $2
        AND verified_at IS NOT NULL AND consumed_at IS NULL
        AND verified_at > now() - make_interval(mins => $3)
        AND ($4::text IS NULL OR phone = $4)
        AND ($5::uuid IS NULL OR auth_user_id = $5::uuid)
      RETURNING phone`,
    id,
    purpose,
    PHONE_CODE.useWithinMinutes,
    match.phone ?? null,
    match.authUserId ?? null,
  );
  if (!row) throw unprocessable('phone_not_verified');
  return row.phone;
}

/** 2026-10-27. Gives a consumed code back when the change it was for could not be made. */
export async function releaseVerification(id: string): Promise<void> {
  await prisma
    .$executeRawUnsafe(
      'UPDATE public.phone_verification SET consumed_at = NULL WHERE id = $1::uuid',
      id,
    )
    .catch(() => undefined);
}
