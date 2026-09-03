import { type Role, type Scope } from '@agri-erp/shared';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { prisma } from '../db';
import { forbidden, unauthenticated } from './errors';

/**
 * THE ONLY PLACE A SESSION IS READ. CONVENTIONS.md section 2.
 *
 * No route parses a cookie or an Authorization header itself. It runs before
 * any data access, in every route, without exception -- the wrapper in
 * ./route.ts is what makes that structural rather than remembered.
 */

export interface Principal {
  readonly kind: 'user' | 'officer';
  /** The application row id, not the auth account id. */
  readonly id: string;
  readonly authUserId: string;
  readonly name: string;
}

export interface Authenticated {
  readonly principal: Principal;
  readonly role: Role;
  readonly scope: Scope;
}

/**
 * Both clients accepted, per CONVENTIONS.md section 2: the web portal presents a
 * Supabase session cookie, the officer app an Authorization bearer token. A
 * route must never require one form specifically.
 */
async function resolveAuthUserId(request: Request): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Supabase URL and publishable key must be set.');

  const header = request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    const { data, error } = await createClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
    }).auth.getUser(token);
    // A banned or deleted auth account fails here, which is half of C-3.6.
    return error || !data.user ? null : data.user.id;
  }

  // No bearer token, so look for a session cookie.
  //
  // `cookies()` THROWS outside a request scope rather than returning empty, and
  // an unhandled throw here becomes a 500 for what is simply an unauthenticated
  // request. The forbidden matrix caught this: every no-session case returned
  // 500 instead of 401. No cookie store means no session, which is a 401.
  let store: Awaited<ReturnType<typeof cookies>>;
  try {
    store = await cookies();
  } catch {
    return null;
  }

  const { data, error } = await createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll(),
      // A route never writes a session cookie; sign-in does that on the client.
      setAll: () => undefined,
    },
  }).auth.getUser();
  return error || !data.user ? null : data.user.id;
}

/**
 * Authenticates, authorises, and resolves what the caller may see.
 *
 * Throws rather than returns a response, so a route that calls it and ignores
 * the result still stops.
 */
export async function requireRole(
  request: Request,
  allowed: readonly Role[],
): Promise<Authenticated> {
  const authUserId = await resolveAuthUserId(request);
  if (!authUserId) throw unauthenticated();

  // Both reads go through the ACTIVE views, which is where C-3.6 lives: a
  // soft-deleted user, or an officer who is soft-deleted OR inactive, has no
  // row here and is refused on their very next request. There are not two kinds
  // of not-active because there is only one place that decides.
  const [staff] = await prisma.$queryRawUnsafe<
    { id: string; name: string; role: Role; scope_state_id: string | null }[]
  >(
    'SELECT id, name, role::text AS role, scope_state_id FROM public.user_active WHERE auth_user_id = $1::uuid LIMIT 1',
    authUserId,
  );

  if (staff) {
    if (!allowed.includes(staff.role)) throw forbidden();
    const scope: Scope =
      staff.role === 'admin'
        ? { kind: 'all' }
        : // The database refuses a supervisor or read_only row without a state,
          // so this cannot be null here. A null scope never means "everything".
          { kind: 'state', stateId: staff.scope_state_id as string };
    return {
      principal: { kind: 'user', id: staff.id, authUserId, name: staff.name },
      role: staff.role,
      scope,
    };
  }

  const [officer] = await prisma.$queryRawUnsafe<
    { id: string; name: string; payam_id: string; state_id: string }[]
  >(
    'SELECT id, name, payam_id, state_id FROM public.officer_active WHERE auth_user_id = $1::uuid LIMIT 1',
    authUserId,
  );

  if (officer) {
    if (!allowed.includes('officer')) throw forbidden();
    return {
      principal: { kind: 'officer', id: officer.id, authUserId, name: officer.name },
      role: 'officer',
      // An officer's caseload is what THEY registered. payamId is here so they
      // can only create in their own payam; it is not a reading permission.
      scope: {
        kind: 'caseload',
        officerId: officer.id,
        payamId: officer.payam_id,
        stateId: officer.state_id,
      },
    };
  }

  // A valid auth account with no application row: the residue of a creation
  // that failed after the account was made. It fails closed, which is the right
  // direction. docs/DECISIONS.md.
  throw unauthenticated();
}
