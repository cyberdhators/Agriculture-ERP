import {
  type Coverage,
  type EffectivePermissions,
  type GrantLike,
  type PermissionKey,
  type PermissionScope,
  type StaffPreset,
  PLATFORM,
  covers,
  effectivePermissions,
  mayLoseSuperAdmin,
} from '@agri-erp/shared';

import { prisma } from '../db';
import { forbidden } from './errors';
import { type Authenticated } from './require-role';

/**
 * STAFF PERMISSIONS, ENFORCED IN THE SERVICE (2026-10-19).
 *
 * The specification: "Enforce permissions in the underlying service, not only
 * by hiding menu items." So every route this lane added calls
 * `requirePermission` after requireRole and before touching data, exactly as
 * requireRole is called before anything else. Hiding a button is a courtesy;
 * this is the control.
 *
 * ADDITIVE. requireRole is not changed and still runs first (the route
 * wrapper calls it). A permission can only NARROW what a role already admits
 * to one of these new routes; it never widens what an existing route allows,
 * and no existing route consults it in this pass.
 *
 * The decision itself is `effectivePermissions` / `covers` in packages/shared,
 * a pure function with its own tests. This file only loads the rows.
 */

type Queryable = { $queryRawUnsafe: <T>(sql: string, ...p: unknown[]) => Promise<T> };

interface GrantRow {
  id: string;
  preset: StaffPreset;
  scope_kind: 'platform' | 'states';
  state_ids: string[] | null;
}

/** The active grants of one staff account, with their states. */
export async function activeGrants(
  client: Queryable,
  userId: string,
): Promise<(GrantLike & { id: string })[]> {
  const rows = await client.$queryRawUnsafe<GrantRow[]>(
    `SELECT g.id, g.preset, g.scope_kind,
            COALESCE(array_agg(s.state_id ORDER BY s.state_id)
                     FILTER (WHERE s.state_id IS NOT NULL), '{}') AS state_ids
       FROM public.staff_permission_grant g
       LEFT JOIN public.staff_permission_grant_state s ON s.grant_id = g.id
      WHERE g.user_id = $1::uuid AND g.revoked_at IS NULL
      GROUP BY g.id`,
    userId,
  );
  return rows.map((r) => ({
    id: r.id,
    preset: r.preset,
    scope: r.scope_kind === 'platform' ? PLATFORM : { kind: 'states', stateIds: r.state_ids ?? [] },
  }));
}

/** What the caller may do, and where. Officers, buyers and farmers hold nothing. */
export async function permissionsOf(auth: Authenticated): Promise<EffectivePermissions> {
  if (auth.principal.kind !== 'user') return new Map();
  return effectivePermissions({
    role: auth.role,
    grants: await activeGrants(prisma, auth.principal.id),
  });
}

/**
 * Throws 403 unless the caller holds `key` over `scope` (the whole platform
 * when omitted). Returns the caller's permissions so a route can ask further
 * questions without a second read.
 *
 * The 403 is the same `forbidden` requireRole uses: a caller without the
 * permission learns nothing about what exists behind the route.
 */
export async function requirePermission(
  auth: Authenticated,
  key: PermissionKey,
  scope: PermissionScope = PLATFORM,
): Promise<EffectivePermissions> {
  const permissions = await permissionsOf(auth);
  if (!covers(permissions.get(key), scope)) throw forbidden();
  return permissions;
}

/**
 * For a list: throws 403 unless the caller holds `key` SOMEWHERE, and returns
 * how far it reaches, so the route can filter to those states.
 */
export async function requirePermissionCoverage(
  auth: Authenticated,
  key: PermissionKey,
): Promise<{ coverage: Coverage; permissions: EffectivePermissions }> {
  const permissions = await permissionsOf(auth);
  const coverage = permissions.get(key);
  if (!coverage || (!coverage.platform && coverage.states.size === 0)) throw forbidden();
  return { coverage, permissions };
}

/**
 * The staff accounts that are Super Admins right now: an active super_admin
 * grant, on an account that is still active and still an administrator.
 *
 * Pass `lock` inside a transaction that changes Super Admins. It takes a
 * transaction-scoped advisory lock first, so two concurrent changes -- two
 * revocations of the last two, or two administrators bootstrapping at once --
 * queue rather than each seeing a world the other is about to change.
 */
export async function activeSuperAdminIds(
  client: Queryable,
  options: { readonly lock?: boolean } = {},
): Promise<string[]> {
  if (options.lock) {
    await client.$queryRawUnsafe(
      // Wrapped so the result is a number, not `void`, which the driver cannot read.
      `SELECT 1 AS locked
         FROM (SELECT pg_advisory_xact_lock(hashtext('agri-erp.staff_permission.super_admin'))) l`,
    );
  }
  const rows = await client.$queryRawUnsafe<{ user_id: string }[]>(
    `SELECT DISTINCT g.user_id
       FROM public.staff_permission_grant g
       JOIN public.user_active u ON u.id = g.user_id AND u.role = 'admin'
      WHERE g.preset = 'super_admin' AND g.revoked_at IS NULL`,
  );
  return rows.map((r) => r.user_id);
}

/**
 * THE LAST SUPER ADMIN, PROTECTED FROM REMOVAL AND DEMOTION as well as from
 * revocation. Called by the existing staff-account route (DELETE, and PATCH
 * when it demotes an administrator) inside its transaction.
 *
 * NOTHING THAT WORKS TODAY MAY STOP WORKING. Until migration 20261019110000 is
 * applied the grant table does not exist, and a query against it would abort
 * the caller's transaction. So the table's presence is asked first, in a form
 * that cannot fail; absent, there are no Super Admins to protect and this
 * allows the change, exactly as before.
 */
export async function wouldLoseLastSuperAdmin(
  client: Queryable,
  targetId: string,
): Promise<boolean> {
  const [present] = await client.$queryRawUnsafe<{ present: boolean }[]>(
    `SELECT to_regclass('public.staff_permission_grant') IS NOT NULL AS present`,
  );
  if (!present?.present) return false;
  return !mayLoseSuperAdmin(await activeSuperAdminIds(client, { lock: true }), targetId);
}
