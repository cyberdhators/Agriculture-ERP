import { createClient } from '@supabase/supabase-js';

import { adminAuthEmails } from '../supabase/admin';

/**
 * RE-AUTHENTICATION FOR SUPER ADMIN DELEGATION (2026-10-19).
 *
 * Before a Super Admin is appointed or removed, the person doing it types
 * their OWN password again. It is checked here, on the server, by a password
 * sign-in against their own account's email address:
 *
 *   - on a THROWAWAY client: no cookie is read or written and nothing is
 *     persisted, so the caller's browser session is exactly what it was;
 *   - the session that sign-in creates is signed out again at once (local
 *     scope: only that one session), so no unused refresh token is left behind;
 *   - the password is never logged, stored, audited or echoed. It exists in
 *     this function's arguments and in the request to Supabase, and nowhere else.
 *
 * MFA (TOTP), OPTIONAL. If the account has a VERIFIED TOTP factor, a six-digit
 * code is required too and verified against that factor on the same throwaway
 * session. Sign-in itself is unchanged: nothing here makes an ordinary sign-in
 * ask for a code. Enrolling a factor is NOT built yet (docs/DECISIONS.md,
 * 2026-10-19): until it is, no account has a factor and this step is the
 * password alone.
 */

export type ReauthOutcome =
  'ok' | 'wrong_password' | 'code_required' | 'code_invalid' | 'unavailable';

/** The same deadline require-role.ts gives a session check. */
const REAUTH_DEADLINE_MS = 10_000;
const fetchWithDeadline: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(REAUTH_DEADLINE_MS) });

/** 400, 401, 403 and 404 are "not this password"; anything else is the service not answering. */
const isRefusal = (status: number | undefined): boolean =>
  status === 400 || status === 401 || status === 403 || status === 404;

export async function reauthenticate(
  authUserId: string,
  password: string,
  totpCode?: string,
): Promise<ReauthOutcome> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return 'unavailable';

  let email: string | undefined;
  try {
    email = (await adminAuthEmails([authUserId])).get(authUserId);
  } catch {
    return 'unavailable';
  }
  // A staff account always has an address; one without cannot be re-authenticated.
  if (!email) return 'unavailable';

  const client = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: fetchWithDeadline },
  });

  let signedIn = false;
  try {
    let result: Awaited<ReturnType<typeof client.auth.signInWithPassword>>;
    try {
      result = await client.auth.signInWithPassword({ email, password });
    } catch {
      return 'unavailable';
    }
    if (result.error) return isRefusal(result.error.status) ? 'wrong_password' : 'unavailable';
    signedIn = true;
    // The address belongs to this account, so this cannot differ; if it ever
    // did, the answer is "no", never "yes".
    if (result.data.user?.id !== authUserId) return 'wrong_password';

    const factors = await client.auth.mfa.listFactors();
    if (factors.error) return 'unavailable';
    const totp = factors.data.totp.find((f) => f.status === 'verified');
    if (!totp) return 'ok';
    if (!totpCode) return 'code_required';
    const verified = await client.auth.mfa.challengeAndVerify({
      factorId: totp.id,
      code: totpCode,
    });
    if (verified.error) return isRefusal(verified.error.status) ? 'code_invalid' : 'unavailable';
    return 'ok';
  } catch {
    return 'unavailable';
  } finally {
    if (signedIn) await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
}
