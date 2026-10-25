import type { SignInOutcome } from '@agri-erp/shared';

/**
 * The app's sign-in screens sign in through POST /api/auth/sign-in
 * (2026-10-28), so the server can record a failed sign-in and apply the rate
 * limit. The session cookie arrives on that response; the browser's Supabase
 * client reads it from there on, as before.
 *
 *   wrong        the identifier and password do not match (never says which)
 *   suspended    the account is suspended or closed
 *   locked       too many attempts; `retryAfterSeconds` says how long to wait
 *   unavailable  the sign-in service or the server could not be reached
 */
export type ServerSignIn =
  | { ok: true; mfaRequired: boolean }
  | { ok: false; reason: 'wrong' | 'suspended' | 'unavailable' }
  | { ok: false; reason: 'locked'; retryAfterSeconds: number };

export async function serverSignIn(identifier: string, password: string): Promise<ServerSignIn> {
  let response: Response;
  try {
    response = await fetch('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after') ?? '900');
    return {
      ok: false,
      reason: 'locked',
      retryAfterSeconds: Number.isFinite(seconds) ? seconds : 900,
    };
  }
  // A malformed identifier is a sign-in that does not match, to the person.
  if (response.status === 400) return { ok: false, reason: 'wrong' };
  if (!response.ok) return { ok: false, reason: 'unavailable' };
  const body = (await response.json().catch(() => ({}))) as { data?: SignInOutcome };
  const outcome = body.data;
  if (!outcome) return { ok: false, reason: 'unavailable' };
  if (outcome.signed_in) return { ok: true, mfaRequired: outcome.mfa_required };
  return { ok: false, reason: outcome.reason };
}

/** "15 minutes", "1 minute": how long to wait, in words. */
export function waitInWords(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}
