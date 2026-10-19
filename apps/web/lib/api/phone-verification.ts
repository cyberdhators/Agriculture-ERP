import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { PHONE_CODE } from '@agri-erp/shared';

import { type AuditTx } from './audit';
import { ApiFailure, unprocessable } from './errors';
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

/** Send a sign-up code to this phone. Returns the verification id and expiry. */
export async function sendSignUpCode(
  phone: string,
  language: 'en' | 'ar',
): Promise<{ id: string; expiresAt: Date }> {
  let config;
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
  if (counts && counts.phone_last_s !== null && counts.phone_last_s < PHONE_CODE.resendSeconds) {
    const wait = PHONE_CODE.resendSeconds - counts.phone_last_s;
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
    `INSERT INTO public.phone_verification (phone, purpose, code_hash, expires_at)
     VALUES ($1, 'farmer_sign_up', 'pending', now() + make_interval(mins => $2))
     RETURNING id, expires_at`,
    phone,
    PHONE_CODE.ttlMinutes,
  );
  await prisma.$executeRawUnsafe(
    'UPDATE public.phone_verification SET code_hash = $2 WHERE id = $1::uuid',
    row!.id,
    hashCode(row!.id, code),
  );

  const text =
    language === 'ar'
      ? `رمز AgriOne: ${code}. صالح لمدة ${PHONE_CODE.ttlMinutes} دقائق. لا تشاركه مع أحد.`
      : `AgriOne code: ${code}. It expires in ${PHONE_CODE.ttlMinutes} minutes. Do not share it.`;
  try {
    const sent = await sendOneSms(config, phone, text);
    if (!sent.accepted) throw new SmsUnavailableError();
  } catch {
    // Not sent: the row is spent so it cannot be verified, and the farmer is
    // told plainly rather than left waiting for an SMS that will not come.
    await prisma
      .$executeRawUnsafe(
        `UPDATE public.phone_verification SET expires_at = now() WHERE id = $1::uuid`,
        row!.id,
      )
      .catch(() => undefined);
    throw new ApiFailure(
      503,
      'sms_unavailable',
      'The code could not be sent just now. Please try again in a few minutes.',
    );
  }
  return { id: row!.id, expiresAt: row!.expires_at };
}

/** Check the code the farmer typed. Marks the verification verified on success. */
export async function verifySignUpCode(id: string, code: string): Promise<void> {
  // One try is counted before the comparison, atomically, so parallel guesses
  // cannot exceed the limit.
  const [row] = await prisma.$queryRawUnsafe<
    { code_hash: string; attempts: number; expired: boolean; verified: boolean }[]
  >(
    `UPDATE public.phone_verification SET attempts = attempts + 1
      WHERE id = $1::uuid AND consumed_at IS NULL
      RETURNING code_hash, attempts, (expires_at < now()) AS expired,
                (verified_at IS NOT NULL) AS verified`,
    id,
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
