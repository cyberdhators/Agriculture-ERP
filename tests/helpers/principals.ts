// Relative, not '@agri-erp/shared': tests/ is not a workspace package. An alias
// would also weaken the workspace-link test in apps/web, which deliberately
// resolves through the real pnpm link so a broken workspace fails.
import { officerAuthIdentifier } from '../../packages/shared/src/identity';
import { PrismaClient } from '@prisma/client';

/**
 * ============================================================================
 * TEST PRINCIPALS. Every future test session depends on these.
 * ============================================================================
 *
 * Creates a real authentication account and a real application row for each
 * role, against staging, and makes requests as them. Documented in
 * docs/api/CONVENTIONS.md.
 *
 * THIS HELPER DELETES AUTHENTICATION ACCOUNTS. That is the same shape of danger
 * as scripts/db-reset.mjs, so it carries the same guard: it refuses to run
 * unless the connection strings positively identify the staging project. A
 * future session with production credentials in .env.local would otherwise run
 * the suite and delete CORWADO's accounts.
 *
 * Everything it creates is prefixed so a crashed run leaves residue that the
 * next run sweeps rather than trips over.
 */

const STAGING_PROJECT_REF = 'xmmxbrxmfgodhpwolrvk';

/** The prefix on every account, row and name this helper creates. */
export const TEST_PREFIX = 'zztest';
/** Every test farmer carries this family name, so the sweep can find them and no reader mistakes them for people. */
export const FARMER_TEST_FAMILY = 'Zztestfamily';
/** Test county/payam codes under state EE. Created by tests/farmers.test.ts, removed by sweep. */
export const TEST_LOCATION_PREFIX = 'EE-ZZT';

export function assertStaging(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const db = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '';
  if (!url.includes(STAGING_PROJECT_REF) || !db.includes(STAGING_PROJECT_REF)) {
    throw new Error(
      'Test principals refuse to run: the Supabase URL and the database URL must both ' +
        `identify the staging project (${STAGING_PROJECT_REF}). This helper creates and ` +
        'DELETES authentication accounts and must never point at production.',
    );
  }
}

export type TestRole = 'admin' | 'supervisor' | 'read_only' | 'officer';

export interface TestPrincipal {
  readonly role: TestRole;
  /** The application row id. */
  readonly id: string;
  readonly authUserId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Officers only. */
  readonly phone?: string;
}

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set to create test principals.`);
  return value;
};

const authCall = async (
  path: string,
  {
    key,
    method = 'GET',
    body,
    token,
  }: { key: string; method?: string; body?: unknown; token?: string },
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(`${env('NEXT_PUBLIC_SUPABASE_URL')}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    /* 204 and friends have no body */
  }
  return { status: response.status, body: parsed };
};

const service = () => env('SUPABASE_SERVICE_ROLE_KEY');
const anon = () => env('NEXT_PUBLIC_SUPABASE_ANON_KEY');

/** A password long enough for the schema, different every run. */
const newPassword = () => `${TEST_PREFIX}-pw-${Math.random().toString(36).slice(2, 12)}`;

async function createAccount(identifier: string, password: string): Promise<string> {
  const created = await authCall('/auth/v1/admin/users', {
    key: service(),
    method: 'POST',
    body: { email: identifier, password, email_confirm: true },
  });
  if (created.status >= 300) {
    throw new Error(
      `Could not create a test account: ${created.status} ${JSON.stringify(created.body)}`,
    );
  }
  return created.body.id as string;
}

async function signIn(
  identifier: string,
  password: string,
): Promise<{ access: string; refresh: string }> {
  const token = await authCall('/auth/v1/token?grant_type=password', {
    key: anon(),
    method: 'POST',
    body: { email: identifier, password },
  });
  if (token.status !== 200) {
    throw new Error(
      `Could not sign in a test principal: ${token.status} ${JSON.stringify(token.body)}`,
    );
  }
  return { access: token.body.access_token as string, refresh: token.body.refresh_token as string };
}

export async function deleteAccount(authUserId: string): Promise<void> {
  await authCall(`/auth/v1/admin/users/${authUserId}`, { key: service(), method: 'DELETE' });
}

/** Signs in again as an existing principal -- used to prove a session has died. */
export async function signInAs(principal: TestPrincipal, password: string) {
  const identifier = principal.phone
    ? officerAuthIdentifier(principal.phone)
    : `${TEST_PREFIX}-${principal.role}-${principal.id}@example.invalid`;
  return authCall('/auth/v1/token?grant_type=password', {
    key: anon(),
    method: 'POST',
    body: { email: identifier, password },
  });
}

/** Exchanges a refresh token, to prove an officer returning from offline still works -- or no longer does. */
export async function refresh(refreshToken: string) {
  return authCall('/auth/v1/token?grant_type=refresh_token', {
    key: anon(),
    method: 'POST',
    body: { refresh_token: refreshToken },
  });
}

export interface Fixtures {
  readonly prisma: PrismaClient;
  readonly stateId: string;
  readonly otherStateId: string;
  readonly payamId: string;
  readonly otherPayamId: string;
}

/**
 * Removes everything a previous run may have left behind.
 *
 * Runs BEFORE creating as well as after, because a crashed run leaves accounts
 * whose phone numbers and rows would collide with the next one.
 */
export async function sweep(prisma: PrismaClient): Promise<void> {
  assertStaging();

  const rows = await prisma.$queryRawUnsafe<{ auth_user_id: string }[]>(
    `SELECT auth_user_id FROM public."user"  WHERE name LIKE '${TEST_PREFIX}%'
     UNION ALL
     SELECT auth_user_id FROM public."officer" WHERE name LIKE '${TEST_PREFIX}%'`,
  );
  for (const row of rows) await deleteAccount(row.auth_user_id);
  // B5: test farmers first (they reference officers). Farmer and consent point
  // at each other with deferred keys, so both go in one transaction.
  await prisma.$transaction([
    prisma.$executeRawUnsafe(
      `DELETE FROM public.consent WHERE farmer_id IN
         (SELECT id FROM public.farmer WHERE family_name LIKE '${FARMER_TEST_FAMILY}%')`,
    ),
    prisma.$executeRawUnsafe(
      `DELETE FROM public.farmer WHERE family_name LIKE '${FARMER_TEST_FAMILY}%'`,
    ),
  ]);
  await prisma.$executeRawUnsafe(
    `DELETE FROM public.farmer_number_counter WHERE county_id LIKE '${TEST_LOCATION_PREFIX}%'`,
  );

  // deleted_by points at the user who did the deleting, so a test admin that
  // soft-deleted anything is referenced by that row and cannot be removed until
  // the reference is cleared. This only affects cleanup: production never
  // hard-deletes a user at all.
  await prisma.$executeRawUnsafe(
    `UPDATE public."user"    SET deleted_by = NULL
     WHERE deleted_by IN (SELECT id FROM public."user" WHERE name LIKE '${TEST_PREFIX}%')`,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE public."officer" SET deleted_by = NULL
     WHERE deleted_by IN (SELECT id FROM public."user" WHERE name LIKE '${TEST_PREFIX}%')`,
  );

  await prisma.$executeRawUnsafe(`DELETE FROM public."officer" WHERE name LIKE '${TEST_PREFIX}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM public."user"    WHERE name LIKE '${TEST_PREFIX}%'`);
  // B5's out-of-state fixtures: a county and payam under EE that exist only during a run.
  await prisma.$executeRawUnsafe(
    `DELETE FROM public.payam  WHERE id LIKE '${TEST_LOCATION_PREFIX}%'`,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM public.county WHERE id LIKE '${TEST_LOCATION_PREFIX}%'`,
  );
}

/**
 * Creates one principal of the given role, signs it in, and returns its tokens.
 *
 * The password is returned so a test can prove a session dies: sign in again and
 * see it refused.
 */
export async function createPrincipal(
  prisma: PrismaClient,
  role: TestRole,
  options: { stateId?: string; payamId?: string; phone?: string } = {},
): Promise<TestPrincipal & { password: string }> {
  assertStaging();
  const password = newPassword();
  const name = `${TEST_PREFIX}-${role}`;

  if (role === 'officer') {
    const phone = options.phone ?? `+2119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const authUserId = await createAccount(officerAuthIdentifier(phone), password);
    const [payam] = await prisma.$queryRawUnsafe<{ id: string; state_id: string }[]>(
      'SELECT id, state_id FROM public.payam_active WHERE id = $1',
      options.payamId,
    );
    if (!payam) throw new Error(`Test payam ${options.payamId} not found.`);
    const [row] = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO public."officer" (auth_user_id, name, phone, payam_id, state_id)
       VALUES ($1::uuid, $2, $3, $4, $5) RETURNING id`,
      authUserId,
      name,
      phone,
      payam.id,
      payam.state_id,
    );
    const tokens = await signIn(officerAuthIdentifier(phone), password);
    return {
      role,
      id: row!.id,
      authUserId,
      phone,
      password,
      accessToken: tokens.access,
      refreshToken: tokens.refresh,
    };
  }

  // Staff. The identifier has to be known before the row exists, so it carries
  // a random suffix rather than the row id.
  const identifier = `${TEST_PREFIX}-${role}-${Math.random().toString(36).slice(2, 10)}@example.invalid`;
  const authUserId = await createAccount(identifier, password);
  const [row] = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO public."user" (auth_user_id, name, role, scope_state_id)
     VALUES ($1::uuid, $2, $3::public.user_role, $4) RETURNING id`,
    authUserId,
    name,
    role,
    role === 'admin' ? null : (options.stateId ?? null),
  );
  const tokens = await signIn(identifier, password);
  return {
    role,
    id: row!.id,
    authUserId,
    password,
    accessToken: tokens.access,
    refreshToken: tokens.refresh,
  };
}
