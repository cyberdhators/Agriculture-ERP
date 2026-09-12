import { createBrowserClient } from '@supabase/ssr';

/**
 * The browser-side Supabase client, used for sign-in and sign-out only. It
 * holds the anon key, which is public by design; it can do nothing a route
 * does not permit, because every read and write still goes through
 * requireRole on the server. The session cookie it writes on sign-in is the
 * one lib/api/require-role.ts reads on every request.
 */

let client: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set.');
  }
  client = createBrowserClient(url, anon);
  return client;
}
