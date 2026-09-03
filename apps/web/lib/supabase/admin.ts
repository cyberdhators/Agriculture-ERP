import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * ============================================================================
 * THE ONLY MODULE THAT READS SUPABASE_SERVICE_ROLE_KEY.
 * ============================================================================
 *
 * That key bypasses row-level security entirely and can read or write any table
 * in the project. It is the most dangerous credential this system holds.
 *
 * THE RULES, and they are not style preferences:
 *
 *   1. This file is the only place `SUPABASE_SERVICE_ROLE_KEY` is read. No other
 *      file calls process.env for it. A test enforces this.
 *   2. This file exports OPERATIONS, never the client. There is no
 *      `getAdminClient()` here on purpose: a general-purpose admin client handed
 *      to a route is the same as having no rule at all, because the next author
 *      uses it for a query that RLS would otherwise have stopped.
 *   3. Each export does one narrow thing to Supabase Auth. None of them touches
 *      an application table — those go through Prisma, as the caller, under
 *      requireRole.
 *   4. Nothing here may be imported by client code. The guard below throws if it
 *      ever loads in a browser, and a test asserts the key never reaches a
 *      client bundle.
 *
 * See docs/DECISIONS.md.
 */

if (typeof window !== 'undefined') {
  // Reached only if a client component imports this, directly or through a
  // chain. Failing loudly at load is better than shipping the key.
  throw new Error(
    'apps/web/lib/supabase/admin.ts loaded in a browser. It holds the service-role key and is server-only.',
  );
}

/** Built lazily so importing this module does not require the key to be set. */
function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Creates an authentication account and returns its id.
 *
 * `identifier` is an email address for office staff, and for an officer it is
 * the value from `officerAuthIdentifier` — never a human-typed address. Marked
 * confirmed at creation because an administrator created it: there is no
 * self-signup to confirm, per C-3.1.
 */
export async function createAuthAccount(identifier: string, password: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.createUser({
    email: identifier,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(
      `Could not create the authentication account: ${error?.message ?? 'no user returned'}`,
    );
  }
  return data.user.id;
}

/**
 * Ends an account's access immediately, including any session already open.
 *
 * C-3.6. Banning revokes the refresh token, so the officer's device cannot
 * silently re-authenticate, and the access token is rejected on its next use.
 */
export async function disableAuthAccount(authUserId: string): Promise<void> {
  const { error } = await adminClient().auth.admin.updateUserById(authUserId, {
    ban_duration: '876000h', // a hundred years; Supabase has no "forever"
  });
  if (error) throw new Error(`Could not disable the authentication account: ${error.message}`);
}

/**
 * Removes an authentication account outright.
 *
 * Used only to undo a half-finished creation — see the compensating transaction
 * in docs/DECISIONS.md. Deactivating a real account is a soft delete plus
 * `disableAuthAccount`, never this.
 */
export async function deleteAuthAccount(authUserId: string): Promise<void> {
  const { error } = await adminClient().auth.admin.deleteUser(authUserId);
  if (error) throw new Error(`Could not delete the authentication account: ${error.message}`);
}

/** Sets a password. An administrator may do this for anyone; a principal for themselves. */
export async function setAuthPassword(authUserId: string, password: string): Promise<void> {
  const { error } = await adminClient().auth.admin.updateUserById(authUserId, { password });
  if (error) throw new Error(`Could not set the password: ${error.message}`);
}

/**
 * Authentication accounts with no application row — the residue of a creation
 * that failed after the account was made and could not be undone.
 *
 * They fail closed: requireRole finds no row and returns 401. But they exist,
 * and the administrator list surfaces them rather than pretending they cannot
 * happen. See docs/DECISIONS.md.
 */
export async function listAuthAccountIds(): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await adminClient().auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list authentication accounts: ${error.message}`);
    ids.push(...data.users.map((u) => u.id));
    if (data.users.length < 200) break;
  }
  return ids;
}
