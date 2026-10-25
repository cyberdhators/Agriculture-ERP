import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { EMAIL_CODE, emailCodeMessage, type AccountLanguage } from '@agri-erp/shared';

import { type AuditTx } from './audit';
import { ApiFailure, unprocessable } from './errors';
import { prisma } from '../db';
import {
  MailerNotConfiguredError,
  MailerUnavailableError,
  mailerConfig,
  mailerIsConfigured,
  sendOneEmail,
} from '../email/resend';

/**
 * EMAIL VERIFICATION BY CODE (2026-10-28, user journeys), server side -- the
 * email twin of lib/api/phone-verification.ts. CORWADO's specification, line
 * 38: "Contact verification activates the account automatically."
 *
 * A code is 6 random digits, sent by Resend with CORWADO's sender, stored only
 * as a hash bound to its own row id, good for 15 minutes and 5 tries. Sending
 * is limited per address and system-wide.
 *
 * WHY A CODE BEFORE THE ACCOUNT, NOT SUPABASE'S OWN CONFIRMATION LINK. The
 * account is created server-side (self-registration stays off on the auth
 * service, C-3.1), so there is no Supabase sign-up to confirm; and a code
 * proven BEFORE the account exists means the account is active the moment it
 * is created -- no half-made, unconfirmed account that cannot sign in and no
 * limited session to police. It is the same shape the phone sign-up already
 * has, so both front doors behave alike.
 *
 * ON BY DEFAULT WHEN RESEND IS CONFIGURED. `EMAIL_VERIFICATION=off` turns it
 * off -- the switch for the day mail turns out not to arrive. Without Resend
 * settings there is nothing to send with, so sign-up works without a code, as
 * before.
 *
 * THE CODE ROUTE NEVER SAYS WHETHER AN ADDRESS HAS AN ACCOUNT: it sends a code
 * to any well-formed address within the limits. (Registration itself still
 * answers 409 for a taken address, as it did before -- recorded in the route.)
 */
export function emailVerificationRequired(): boolean {
  if ((process.env.EMAIL_VERIFICATION ?? '').toLowerCase() === 'off') return false;
  return mailerIsConfigured();
}

const hashCode = (id: string, code: string): string =>
  createHash('sha256').update(`email:${id}:${code}`).digest('hex');

const tooMany = (message: string, retryAfterSeconds: number) =>
  new ApiFailure(429, 'email_code_rate_limited', message, undefined, {
    'retry-after': String(retryAfterSeconds),
  });

/** Issue and send a sign-up code to this (lower-case) address. */
export async function sendEmailSignUpCode(
  email: string,
  language: AccountLanguage,
): Promise<{ id: string; expiresAt: Date }> {
  let config: ReturnType<typeof mailerConfig>;
  try {
    config = mailerConfig();
  } catch (failure) {
    if (failure instanceof MailerNotConfiguredError) {
      throw new ApiFailure(503, 'email_not_configured', 'Codes cannot be sent just now.');
    }
    throw failure;
  }

  const [counts] = await prisma.$queryRawUnsafe<
    { address_recent: number; address_last_s: number | null; system_hour: number }[]
  >(
    `SELECT
       count(*) FILTER (WHERE email = $1 AND created_at > now() - make_interval(mins => $2))::int
         AS address_recent,
       EXTRACT(EPOCH FROM now() - max(created_at) FILTER (WHERE email = $1))::int AS address_last_s,
       count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS system_hour
     FROM public.email_verification
     WHERE created_at > now() - interval '1 hour' OR email = $1`,
    email,
    EMAIL_CODE.windowMinutes,
  );
  if (
    counts &&
    counts.address_last_s !== null &&
    counts.address_last_s < EMAIL_CODE.resendSeconds
  ) {
    const wait = EMAIL_CODE.resendSeconds - counts.address_last_s;
    throw tooMany(`Please wait ${wait} seconds before asking for another code.`, wait);
  }
  if (counts && counts.address_recent >= EMAIL_CODE.perAddress) {
    throw tooMany(
      `Too many codes for this address. Try again in ${EMAIL_CODE.windowMinutes} minutes.`,
      EMAIL_CODE.windowMinutes * 60,
    );
  }
  if (counts && counts.system_hour >= EMAIL_CODE.perHourSystem) {
    throw tooMany('Codes are busy just now. Please try again later.', 600);
  }

  const code = String(randomInt(0, 10 ** EMAIL_CODE.length)).padStart(EMAIL_CODE.length, '0');
  const [row] = await prisma.$queryRawUnsafe<{ id: string; expires_at: Date }[]>(
    `INSERT INTO public.email_verification (email, purpose, code_hash, expires_at)
     VALUES ($1, 'sign_up', 'pending', now() + make_interval(mins => $2))
     RETURNING id, expires_at`,
    email,
    EMAIL_CODE.ttlMinutes,
  );
  await prisma.$executeRawUnsafe(
    'UPDATE public.email_verification SET code_hash = $2 WHERE id = $1::uuid',
    row!.id,
    hashCode(row!.id, code),
  );

  const message = emailCodeMessage(code, language);
  let accepted = false;
  try {
    accepted = (await sendOneEmail(config, email, message.subject, message.text)).accepted;
  } catch (failure) {
    if (!(failure instanceof MailerUnavailableError)) throw failure;
  }
  if (!accepted) {
    // Not sent: the row is spent so it cannot be verified.
    await prisma
      .$executeRawUnsafe(
        'UPDATE public.email_verification SET expires_at = now() WHERE id = $1::uuid',
        row!.id,
      )
      .catch(() => undefined);
    throw new ApiFailure(
      503,
      'email_unavailable',
      'The code could not be sent just now. Please try again in a few minutes.',
    );
  }
  return { id: row!.id, expiresAt: row!.expires_at };
}

/** Check a typed code. Marks the verification verified on success. */
export async function verifyEmailCode(id: string, code: string): Promise<void> {
  // One try is counted before the comparison, atomically.
  const [row] = await prisma.$queryRawUnsafe<
    { code_hash: string; attempts: number; expired: boolean; verified: boolean }[]
  >(
    `UPDATE public.email_verification SET attempts = LEAST(attempts + 1, 100)
      WHERE id = $1::uuid AND consumed_at IS NULL AND purpose = 'sign_up'
      RETURNING code_hash, attempts, (expires_at < now()) AS expired,
                (verified_at IS NOT NULL) AS verified`,
    id,
  );
  if (!row || row.expired) throw unprocessable('email_code_expired');
  if (row.verified) return;
  if (row.attempts > EMAIL_CODE.maxAttempts) throw unprocessable('email_code_too_many_tries');
  const expected = Buffer.from(row.code_hash, 'hex');
  const given = Buffer.from(hashCode(id, code), 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw unprocessable('email_code_wrong');
  }
  await prisma.$executeRawUnsafe(
    'UPDATE public.email_verification SET verified_at = now() WHERE id = $1::uuid',
    id,
  );
}

/**
 * Inside the sign-up transaction: the verification must be this address's,
 * verified, recent and not used before. Used up here: one code, one account.
 */
export async function consumeEmailSignUpVerification(
  tx: AuditTx,
  id: string | undefined,
  email: string,
): Promise<void> {
  if (!id) throw unprocessable('email_not_verified');
  const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
    `UPDATE public.email_verification SET consumed_at = now()
      WHERE id = $1::uuid AND email = $2 AND purpose = 'sign_up'
        AND verified_at IS NOT NULL AND consumed_at IS NULL
        AND verified_at > now() - make_interval(mins => $3)
      RETURNING id`,
    id,
    email,
    EMAIL_CODE.useWithinMinutes,
  );
  if (!row) throw unprocessable('email_not_verified');
}
