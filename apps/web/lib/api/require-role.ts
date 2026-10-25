import { accountSideFor } from './account-role';
import {
  type MfaFacts,
  type Role,
  type Scope,
  aalOfToken,
  staffMfaGate,
  staffMfaMode,
} from '@agri-erp/shared';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { prisma } from '../db';
import {
  authUnavailable,
  forbidden,
  mfaEnrolmentRequired,
  mfaRequired,
  unauthenticated,
} from './errors';

/**
 * THE ONLY PLACE A SESSION IS READ. CONVENTIONS.md section 2.
 *
 * No route parses a cookie or an Authorization header itself. It runs before
 * any data access, in every route, without exception -- the wrapper in
 * ./route.ts is what makes that structural rather than remembered.
 */

export interface Principal {
  readonly kind: 'user' | 'officer' | 'buyer' | 'farmer';
  /** The application row id, not the auth account id. */
  readonly id: string;
  readonly authUserId: string;
  readonly name: string;
}

export interface Authenticated {
  readonly principal: Principal;
  readonly role: Role;
  readonly scope: Scope;
  /**
   * 2026-10-28: the session's two-step state, for staff only (absent for
   * officers, buyers and farmers). GET /api/me reports it to the portal.
   */
  readonly mfa?: MfaFacts;
}

/** What the session check learned about the caller. */
interface SessionFacts {
  readonly authUserId: string;
  /** At least one VERIFIED authenticator factor on the account (from getUser). */
  readonly hasVerifiedFactor: boolean;
  /** The validated access token's `aal` claim. */
  readonly aal: 'aal1' | 'aal2' | null;
}

type FactorList = readonly { readonly status?: string }[] | undefined;
const hasVerified = (factors: FactorList): boolean =>
  (factors ?? []).some((f) => f.status === 'verified');

export interface RequireRoleOptions {
  /**
   * 2026-10-28: the few routes a staff session needs in order to FINISH
   * signing in or to enrol in two-step sign-in (GET /api/me and
   * /api/staff/mfa/**). Every other route leaves this unset.
   */
  readonly mfaExempt?: boolean;
}

/**
 * Both clients accepted, per CONVENTIONS.md section 2: the web portal presents a
 * Supabase session cookie, the officer app an Authorization bearer token. A
 * route must never require one form specifically.
 */
async function resolveSession(request: Request): Promise<SessionFacts | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Supabase URL and publishable key must be set.');

  const header = request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    let result: Awaited<ReturnType<ReturnType<typeof createClient>['auth']['getUser']>>;
    try {
      result = await createClient(url, anon, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { fetch: fetchWithDeadline },
      }).auth.getUser(token);
    } catch {
      // The call itself failed: the service is unreachable, not the session (B6.5).
      throw authUnavailable();
    }
    const { data, error } = result;
    if (error) {
      if (isSessionRefusal(error.status)) return null;
      throw authUnavailable();
    }
    return data.user
      ? {
          authUserId: data.user.id,
          hasVerifiedFactor: hasVerified(data.user.factors),
          // getUser has just accepted this token, so its claim can be read.
          aal: aalOfToken(token),
        }
      : null;
  }

  // Cookie session (the web portal). Outside a request scope cookies() throws;
  // that is "no session", not a fault.
  let store: Awaited<ReturnType<typeof cookies>>;
  try {
    store = await cookies();
  } catch {
    return null;
  }
  let result: Awaited<ReturnType<ReturnType<typeof createServerClient>['auth']['getUser']>>;
  const client = createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll(),
      // A route never writes a session cookie (the sign-in route and the
      // middleware do); a refresh made here is used for this request only.
      setAll: () => undefined,
    },
    global: { fetch: fetchWithDeadline },
  });
  try {
    result = await client.auth.getUser();
  } catch {
    throw authUnavailable();
  }
  const { data, error } = result;
  if (error) {
    if (isSessionRefusal(error.status)) return null;
    throw authUnavailable();
  }
  if (!data.user) return null;
  // The token getUser just validated is the session's own; its `aal` claim
  // says whether the code step was passed. Read from memory, no second call.
  let token: string | null;
  try {
    token = (await client.auth.getSession()).data.session?.access_token ?? null;
  } catch {
    token = null;
  }
  return {
    authUserId: data.user.id,
    hasVerifiedFactor: hasVerified(data.user.factors),
    aal: aalOfToken(token),
  };
}

/**
 * B6.5. The service answered about the session: 400, 401, 403 and 404 are
 * "this token is not a session" and stay 401 unauthenticated. Anything else
 * — 429, 5xx, a network failure (status 0 or undefined), a deadline — is the
 * service failing to answer, and is 503 auth_unavailable. Proved by a test
 * that stands up a failing service, not by this comment.
 */
export const isSessionRefusal = (status: number | undefined): boolean =>
  status === 400 || status === 401 || status === 403 || status === 404;

/** A hung sign-in service must not hang every route: ten seconds, then 503. */
export const AUTH_CALL_DEADLINE_MS = 10_000;
const fetchWithDeadline: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(AUTH_CALL_DEADLINE_MS) });

/**
 * Authenticates, authorises, and resolves what the caller may see.
 *
 * Throws rather than returns a response, so a route that calls it and ignores
 * the result still stops.
 */
export async function requireRole(
  request: Request,
  allowed: readonly Role[],
  options: RequireRoleOptions = {},
): Promise<Authenticated> {
  const session = await resolveSession(request);
  if (!session) throw unauthenticated();
  const { authUserId } = session;

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
    // 2026-10-28: TWO-STEP SIGN-IN, before the role check so a half-signed-in
    // session learns only that it must finish signing in. staffMfaGate
    // (packages/shared/src/staff-security.ts) holds the rule and the rollout.
    const mfa: MfaFacts = {
      role: staff.role,
      hasVerifiedFactor: session.hasVerifiedFactor,
      aal: session.aal,
    };
    const gate = staffMfaGate(
      mfa,
      staffMfaMode(process.env.STAFF_MFA_ENFORCEMENT),
      options.mfaExempt === true,
    );
    if (gate === 'verify_required') throw mfaRequired();
    if (gate === 'enrolment_required') throw mfaEnrolmentRequired();

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
      mfa,
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

  // B13. A buyer: an outside organisation's purchaser. Read through
  // buyer_active, so a removed buyer -- or a buyer whose organisation was
  // removed -- has no row and is refused on their next request, as staff are.
  // A buyer is admitted ONLY to a route that names 'buyer'; ALL_ROLES does not
  // include it, so every existing route refuses a buyer with 403.
  const [buyer] = await prisma.$queryRawUnsafe<
    {
      id: string;
      given_name: string;
      family_name: string;
      organization_id: string;
      verification_status:
        'pending' | 'under_review' | 'verified' | 'rejected' | 'suspended' | 'not_required';
    }[]
  >(
    `SELECT b.id, b.given_name, b.family_name, b.organization_id,
            o.verification_status::text AS verification_status
       FROM public.buyer_active b
       JOIN public.buyer_organization_active o ON o.id = b.organization_id
      WHERE b.auth_user_id = $1::uuid AND b.suspended_at IS NULL LIMIT 1`,
    authUserId,
  );

  // B14. A farmer with their own account (2026-10-07). Read through
  // farmer_active, so a removed farmer is refused on their next request. A
  // merged farmer keeps a row but has been folded into another record, so they
  // are refused too: the survivor is the record that signs in.
  // 2026-10-21: and a record staff have suspended is refused on its next
  // request, whatever its session (the sign-in is banned as well).
  const [farmer] = await prisma.$queryRawUnsafe<
    { id: string; given_name: string; family_name: string }[]
  >(
    `SELECT id, given_name, family_name FROM public.farmer_active
      WHERE auth_user_id = $1::uuid AND merged_into IS NULL AND suspended_at IS NULL LIMIT 1`,
    authUserId,
  );

  /*
   * ONE ACCOUNT, BUYING AND SELLING (2026-10-19, CORWADO's specification and
   * the owner's decision, reversing "option A"). One sign-in may carry both a
   * buyer and a farmer record. Each route still names who it serves: a buyer
   * route answers the account as its buyer, a farmer route as its farmer, and
   * a route that admits both takes the first of its own `roles` the account
   * holds. An account with neither of a route's roles is refused, as before.
   */
  if (buyer || farmer) {
    const side = accountSideFor(allowed, { buyer: Boolean(buyer), farmer: Boolean(farmer) });
    if (side === 'buyer' && buyer) {
      return {
        principal: {
          kind: 'buyer',
          id: buyer.id,
          authUserId,
          name: `${buyer.given_name} ${buyer.family_name}`,
        },
        role: 'buyer',
        scope: {
          kind: 'buyer',
          buyerId: buyer.id,
          organizationId: buyer.organization_id,
          verification: buyer.verification_status,
        },
      };
    }
    if (side === 'farmer' && farmer) {
      return {
        principal: {
          kind: 'farmer',
          id: farmer.id,
          authUserId,
          name: `${farmer.given_name} ${farmer.family_name}`,
        },
        role: 'farmer',
        scope: { kind: 'farmer', farmerId: farmer.id },
      };
    }
    throw forbidden();
  }

  // A valid auth account with no application row: the residue of a creation
  // that failed after the account was made. It fails closed, which is the right
  // direction. docs/DECISIONS.md.
  throw unauthenticated();
}
