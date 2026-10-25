import { type SignInOutcome, type SignInRequest, signInRequestSchema } from '@agri-erp/shared';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { recordSignInFailed } from '../../../../lib/api/access-log';
import { authUnavailable, rateLimited } from '../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../lib/api/route';
import {
  accountForIdentifier,
  addressBrake,
  clientAddress,
  hashIdentifier,
  identifierWait,
  recordAttempt,
} from '../../../../lib/api/sign-in';

/**
 * POST /api/auth/sign-in { identifier, password } -- password sign-in through
 * the server (2026-10-28, lane-security). PUBLIC: the caller is signing in.
 *
 * WHY THROUGH THE SERVER. Sign-in used to go from the browser straight to
 * Supabase Auth, so no server ever saw a failed sign-in and the access log
 * could not record one, which the specification asks for. The app's sign-in
 * screens (staff, buyer, farmer) now post here instead; this route signs in
 * with the same anon key, and the session cookie is written on this response
 * exactly as the browser client would have written it (@supabase/ssr's
 * documented route-handler pattern). Nothing about the session itself changes.
 *
 * IN ORDER:
 *   1. the per-address brake (in memory, never stored)            -> 429
 *   2. the per-identifier limit: 5 failures in 15 minutes         -> 429
 *   3. the password sign-in
 *   4. a wrong password: the attempt is counted (hashed identifier), and, if
 *      the identifier belongs to an account, `sign_in_failed` is written to
 *      that account's access log
 *
 * THE ANSWER NEVER SAYS WHETHER AN ACCOUNT EXISTS: a wrong password and an
 * unknown identifier are the same `{ signed_in: false, reason: 'wrong' }`, and
 * the limit treats both alike. A suspended or closed account is told so, as
 * the sign-in screens already did.
 *
 * TWO-STEP. If the account has an authenticator, the session made here is at
 * the first level only; `mfa_required: true` tells the screen to ask for the
 * code (verified in the browser against Supabase, which raises the session).
 * requireRole refuses a staff session that has not done so.
 *
 * WHAT THIS DOES NOT COVER. Anyone holding the public anon key can still call
 * Supabase Auth directly, bypassing this route; those attempts are limited by
 * Supabase's own rate limits and appear in its auth logs, not here.
 * docs/DECISIONS.md says so.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: signInRequestSchema,
    handler: async ({ body: raw, request }) => {
      const body = raw as SignInRequest;
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon) throw authUnavailable();

      const addressWait = addressBrake(clientAddress(request));
      if (addressWait > 0) throw rateLimited(addressWait);

      const hash = hashIdentifier(body.identifier);
      const wait = await identifierWait(hash);
      if (wait > 0) throw rateLimited(wait);

      const store = await cookies();
      const client = createServerClient(url, anon, {
        cookies: {
          getAll: () => store.getAll(),
          setAll: (toSet) => {
            for (const { name, value, options } of toSet) store.set(name, value, options);
          },
        },
        global: {
          fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
        },
      });

      let result: Awaited<ReturnType<typeof client.auth.signInWithPassword>>;
      try {
        result = await client.auth.signInWithPassword({
          email: body.identifier,
          password: body.password,
        });
      } catch {
        throw authUnavailable();
      }

      if (result.error) {
        if (result.error.code === 'user_banned') {
          const answer: SignInOutcome = { signed_in: false, reason: 'suspended' };
          return ok(answer);
        }
        const status = result.error.status;
        const refused = status === 400 || status === 401 || status === 403 || status === 404;
        if (!refused) throw authUnavailable();

        await recordAttempt(hash, false);
        const account = await accountForIdentifier(body.identifier);
        if (account) await recordSignInFailed(account.kind, account.id, request);
        const answer: SignInOutcome = { signed_in: false, reason: 'wrong' };
        return ok(answer);
      }

      await recordAttempt(hash, true);
      const factors = result.data.user?.factors ?? [];
      const answer: SignInOutcome = {
        signed_in: true,
        mfa_required: factors.some((f) => f.status === 'verified'),
      };
      return ok(answer);
    },
  },
});
