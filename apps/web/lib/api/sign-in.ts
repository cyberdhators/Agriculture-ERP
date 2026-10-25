import { type AccessPrincipalKind, SIGN_IN_LIMITS, signInRateDecision } from '@agri-erp/shared';
import { createHash } from 'node:crypto';

import { prisma } from '../db';

/**
 * SIGN-IN THROUGH THE SERVER (2026-10-28, lane-security). The pieces
 * POST /api/auth/sign-in is made of, kept here so the route reads as its
 * steps. docs/DECISIONS.md, "Sign-in through the server: failed sign-ins and
 * a rate limit".
 *
 * WHAT IS STORED. The identifier only as a SHA-256 hash (sign_in_attempt),
 * the outcome and the time. A failed attempt on an account that exists also
 * writes `sign_in_failed` to that account's access log. Never the password,
 * never an IP address, never the user agent.
 *
 * NOTHING HERE MAY STOP A CORRECT SIGN-IN. Every database step swallows its
 * own failure: if the attempt table is missing (migration not yet applied) or
 * slow, the limit is simply not applied and the person signs in as before.
 */

/** The hash the attempt table keys on. The identifier arrives lower-cased. */
export const hashIdentifier = (identifier: string): string =>
  createHash('sha256').update(identifier.trim().toLowerCase()).digest('hex');

// ---------------------------------------------------------------------------
// THE PER-ADDRESS BRAKE -- in memory, per server instance, never stored
// ---------------------------------------------------------------------------

const MAX_TRACKED_ADDRESSES = 10_000;
const addressHits = new Map<string, number[]>();

/** The first address in x-forwarded-for (Vercel sets it), or null. */
export function clientAddress(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first ? first : (request.headers.get('x-real-ip')?.trim() ?? null);
}

/**
 * Counts an attempt from this address and says whether it is over the brake.
 * Returns the seconds to wait, or 0 when the attempt may go ahead.
 */
export function addressBrake(address: string | null, nowMs = Date.now()): number {
  if (!address) return 0;
  const since = nowMs - SIGN_IN_LIMITS.windowMs;
  const hits = (addressHits.get(address) ?? []).filter((t) => t > since);
  if (hits.length >= SIGN_IN_LIMITS.maxAttemptsPerAddress) {
    addressHits.set(address, hits);
    return Math.max(1, Math.ceil((hits[0]! + SIGN_IN_LIMITS.windowMs - nowMs) / 1000));
  }
  hits.push(nowMs);
  if (addressHits.size >= MAX_TRACKED_ADDRESSES) addressHits.clear();
  addressHits.set(address, hits);
  return 0;
}

// ---------------------------------------------------------------------------
// THE PER-IDENTIFIER LIMIT -- in the database, across instances
// ---------------------------------------------------------------------------

/** Seconds to wait before another attempt for this identifier, or 0. */
export async function identifierWait(hash: string, nowMs = Date.now()): Promise<number> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ attempted_at: Date; succeeded: boolean }[]>(
      `SELECT attempted_at, succeeded FROM public.sign_in_attempt
        WHERE identifier_hash = $1 AND attempted_at > now() - ($2::int * interval '1 millisecond')
        ORDER BY attempted_at DESC LIMIT 50`,
      hash,
      SIGN_IN_LIMITS.windowMs,
    );
    const decision = signInRateDecision({
      attempts: rows.map((r) => ({ atMs: r.attempted_at.getTime(), succeeded: r.succeeded })),
      nowMs,
    });
    return decision.allowed ? 0 : decision.retryAfterSeconds;
  } catch {
    return 0;
  }
}

/** Records one attempt; now and then, sweeps attempts older than a day. */
export async function recordAttempt(hash: string, succeeded: boolean): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO public.sign_in_attempt (identifier_hash, succeeded) VALUES ($1, $2)`,
      hash,
      succeeded,
    );
    if (Math.random() < 0.02) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM public.sign_in_attempt
          WHERE attempted_at < now() - ($1::int * interval '1 millisecond')`,
        SIGN_IN_LIMITS.keepMs,
      );
    }
  } catch {
    // Best effort; see the header.
  }
}

// ---------------------------------------------------------------------------
// WHOSE ACCOUNT A FAILED ATTEMPT WAS AGAINST
// ---------------------------------------------------------------------------

/**
 * The application account behind a sign-in identifier, for the access log.
 * The identifier is looked up in the authentication store's own table
 * (auth.users, same database) and only its id is read; the address itself
 * never leaves this query. Staff first, then officer, buyer, farmer -- the
 * same order requireRole uses. Null when there is no such account, or when
 * the lookup is not permitted (then the failure is simply not logged).
 */
export async function accountForIdentifier(
  identifier: string,
): Promise<{ kind: AccessPrincipalKind; id: string } | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ kind: AccessPrincipalKind; id: string }[]>(
      `WITH a AS (SELECT id FROM auth.users WHERE lower(email) = $1 LIMIT 1)
       SELECT 'user' AS kind, u.id FROM public.user_active u JOIN a ON a.id = u.auth_user_id
       UNION ALL
       SELECT 'officer', o.id FROM public.officer_active o JOIN a ON a.id = o.auth_user_id
       UNION ALL
       SELECT 'buyer', b.id FROM public.buyer_active b JOIN a ON a.id = b.auth_user_id
       UNION ALL
       SELECT 'farmer', f.id FROM public.farmer_active f JOIN a ON a.id = f.auth_user_id
        WHERE f.merged_into IS NULL
       LIMIT 1`,
      identifier.trim().toLowerCase(),
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
