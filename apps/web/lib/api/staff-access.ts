import { type PermissionScope, type StaffPreset, PLATFORM, toIso } from '@agri-erp/shared';

import { prisma } from '../db';
import { ApiFailure, authUnavailable, notFound, unprocessable } from './errors';
import { type ReauthOutcome } from './reauth';

/**
 * Reads and presenters shared by the staff-access routes (2026-10-19). The
 * permission decision itself is in ./permissions.ts and packages/shared.
 */

type Queryable = { $queryRawUnsafe: <T>(sql: string, ...p: unknown[]) => Promise<T> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StaffTarget {
  id: string;
  auth_user_id: string;
  name: string;
  role: string;
  scope_state_id: string | null;
}

/** An ACTIVE staff account, or 404 -- a removed account receives no new permissions. */
export async function loadActiveStaff(client: Queryable, id: string): Promise<StaffTarget> {
  if (!UUID.test(id)) throw notFound();
  const [row] = await client.$queryRawUnsafe<StaffTarget[]>(
    `SELECT id, auth_user_id, name, role::text AS role, scope_state_id
       FROM public.user_active WHERE id = $1::uuid`,
    id,
  );
  if (!row) throw notFound();
  return row;
}

/**
 * Where a staff account LIVES, for the question "may you manage them?". A
 * supervisor or read-only account sits in its state; an administrator is
 * national, so only someone holding the permission platform-wide manages one.
 */
export const homeScope = (target: Pick<StaffTarget, 'scope_state_id'>): PermissionScope =>
  target.scope_state_id ? { kind: 'states', stateIds: [target.scope_state_id] } : PLATFORM;

export interface GrantRecord {
  id: string;
  user_id: string;
  preset: StaffPreset;
  scope_kind: 'platform' | 'states';
  state_ids: string[];
  reason: string;
  granted_by: string;
  granted_at: Date;
  revoked_at: Date | null;
}

export async function loadGrant(client: Queryable, id: string): Promise<GrantRecord> {
  if (!UUID.test(id)) throw notFound();
  const [row] = await client.$queryRawUnsafe<GrantRecord[]>(
    `SELECT g.id, g.user_id, g.preset, g.scope_kind, g.reason, g.granted_by, g.granted_at,
            g.revoked_at,
            COALESCE(array_agg(s.state_id ORDER BY s.state_id)
                     FILTER (WHERE s.state_id IS NOT NULL), '{}') AS state_ids
       FROM public.staff_permission_grant g
       LEFT JOIN public.staff_permission_grant_state s ON s.grant_id = g.id
      WHERE g.id = $1::uuid
      GROUP BY g.id`,
    id,
  );
  if (!row) throw notFound();
  return row;
}

export const scopeOfGrant = (g: Pick<GrantRecord, 'scope_kind' | 'state_ids'>): PermissionScope =>
  g.scope_kind === 'platform' ? PLATFORM : { kind: 'states', stateIds: g.state_ids };

export const presentGrant = (g: GrantRecord) => ({
  id: g.id,
  user_id: g.user_id,
  preset: g.preset,
  scope: g.scope_kind,
  state_ids: g.state_ids,
  reason: g.reason,
  granted_by: g.granted_by,
  granted_at: toIso(g.granted_at),
});

/** Every named state must exist and be active, or the grant is refused as a whole. */
export async function requireStatesExist(stateIds: readonly string[]): Promise<void> {
  if (stateIds.length === 0) return;
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM public.state WHERE id = ANY($1::text[]) AND deleted_at IS NULL`,
    [...stateIds],
  );
  if (rows.length !== new Set(stateIds).size) throw unprocessable('state_not_found');
}

/** Postgres's unique violation, raised through Prisma's raw query error. */
export const isUniqueViolation = (error: unknown, constraint: string): boolean => {
  if (!(error instanceof Error)) return false;
  if (error.message.includes(constraint)) return true;
  // 2026-10-28 (live acceptance): a raw query's unique violation can arrive
  // as P2010 with code 23505 and no constraint name in the message. The
  // name may be in its meta; if no name is given at all, a 23505 is taken as
  // this constraint (the callers' statements touch one unique index).
  const meta = (error as { meta?: { code?: unknown; message?: unknown } }).meta;
  if (meta?.code !== '23505') return false;
  const detail = typeof meta.message === 'string' ? meta.message : '';
  return detail.includes(constraint) || !/_key|_one_|_unique|_pkey/.test(detail);
};

/**
 * Turns a re-authentication outcome into the route's answer. `onFailedPassword`
 * records the failure in the access log before the refusal is thrown.
 */
export async function requireReauth(
  outcome: ReauthOutcome,
  onFailedPassword: () => Promise<void>,
): Promise<void> {
  switch (outcome) {
    case 'ok':
      return;
    case 'wrong_password':
      await onFailedPassword();
      throw unprocessable('reauth_failed');
    case 'code_required':
      throw unprocessable('reauth_code_required');
    case 'code_invalid':
      await onFailedPassword();
      throw unprocessable('reauth_code_invalid');
    case 'unavailable':
      throw authUnavailable();
    default: {
      const never: never = outcome;
      throw new ApiFailure(500, 'internal_error', String(never));
    }
  }
}
