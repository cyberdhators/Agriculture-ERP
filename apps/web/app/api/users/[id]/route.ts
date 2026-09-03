import { patchUserSchema, toIso } from '@agri-erp/shared';

import { notFound, unprocessable } from '../../../../lib/api/errors';
import { defineRoutes, empty, ok } from '../../../../lib/api/route';
import { requireWriter } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';
import { disableAuthAccount, setAuthPassword } from '../../../../lib/supabase/admin';

interface UserRow {
  id: string;
  auth_user_id: string;
  name: string;
  role: string;
  scope_state_id: string | null;
  last_login_at: Date | null;
  created_at: Date;
}

const present = (row: UserRow) => ({
  id: row.id,
  name: row.name,
  role: row.role,
  state_id: row.scope_state_id,
  last_login_at: row.last_login_at ? toIso(row.last_login_at) : null,
  created_at: toIso(row.created_at),
});

/**
 * Loads a staff account the caller is allowed to see, or throws 404.
 *
 * Out of scope and does-not-exist are the SAME response, byte for byte -- C-3.5
 * and CONVENTIONS section 5.1. Returning 403 for "exists but is not yours"
 * would confirm the record exists, which against guessed ids reveals who has an
 * account.
 */
async function loadVisible(id: string, stateId: string | null): Promise<UserRow> {
  // A malformed uuid must be 404, not a 500 from the database.
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();

  const [row] = await prisma.$queryRawUnsafe<UserRow[]>(
    `SELECT id, auth_user_id, name, role::text AS role, scope_state_id, last_login_at, created_at
     FROM public.user_active
     WHERE id = $1::uuid ${stateId ? 'AND scope_state_id = $2' : ''}`,
    ...(stateId ? [id, stateId] : [id]),
  );
  if (!row) throw notFound();
  return row;
}

/**
 * Counts remaining administrators, locking them for the length of the
 * transaction.
 *
 * Without the lock, two concurrent demotions each see two admins, each proceeds,
 * and CORWADO is locked out of their own system. The lock makes them queue.
 */
async function otherAdminExists(
  tx: { $queryRawUnsafe: <T>(sql: string, ...p: unknown[]) => Promise<T> },
  excludingId: string,
): Promise<boolean> {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM public."user"
     WHERE role = 'admin' AND deleted_at IS NULL AND id <> $1::uuid
     FOR UPDATE`,
    excludingId,
  );
  return rows.length > 0;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth, params }) =>
      ok(
        present(
          await loadVisible(
            params.id ?? '',
            auth.scope.kind === 'state' ? auth.scope.stateId : null,
          ),
        ),
      ),
  },

  PATCH: {
    roles: ['admin'],
    bodySchema: patchUserSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const target = await loadVisible(params.id ?? '', null);

      // An admin cannot change their own role. Demoting yourself is the same
      // mistake as removing yourself, arriving by a different door.
      if (target.id === auth.principal.id && body.role !== undefined && body.role !== target.role) {
        throw unprocessable('cannot_change_own_role');
      }

      const demoting = body.role !== undefined && target.role === 'admin' && body.role !== 'admin';

      const updated = await prisma.$transaction(
        async (tx) => {
          if (demoting && !(await otherAdminExists(tx as never, target.id))) {
            throw unprocessable('last_admin_cannot_be_demoted');
          }

          const nextRole = body.role ?? target.role;
          // The database refuses an admin with a state and a supervisor
          // without one, so keep the pair consistent here rather than let the
          // constraint produce a 500.
          const nextState = nextRole === 'admin' ? null : (body.state_id ?? target.scope_state_id);
          if (nextRole !== 'admin' && !nextState) throw unprocessable('state_not_found');

          const [row] = await tx.$queryRawUnsafe<UserRow[]>(
            `UPDATE public."user"
             SET name = COALESCE($2, name),
                 role = $3::public.user_role,
                 scope_state_id = $4
             WHERE id = $1::uuid AND deleted_at IS NULL
             RETURNING id, auth_user_id, name, role::text AS role, scope_state_id, last_login_at, created_at`,
            target.id,
            body.name ?? null,
            nextRole,
            nextState,
          );
          if (!row) throw notFound();
          return row;
        },
        { maxWait: 30_000, timeout: 120_000 },
      );

      // Outside the transaction: an HTTP call cannot be rolled back, and a
      // password that changed while the row did not is recoverable, whereas the
      // reverse silently leaves the old password working.
      if (body.password) await setAuthPassword(target.auth_user_id, body.password);

      return ok(present(updated));
    },
  },

  DELETE: {
    roles: ['admin'],
    handler: async ({ auth, params }) => {
      requireWriter(auth);
      const target = await loadVisible(params.id ?? '', null);

      if (target.id === auth.principal.id) throw unprocessable('cannot_remove_own_account');

      await prisma.$transaction(
        async (tx) => {
          if (target.role === 'admin' && !(await otherAdminExists(tx as never, target.id))) {
            throw unprocessable('last_admin_cannot_be_removed');
          }
          await tx.$executeRawUnsafe(
            `UPDATE public."user" SET deleted_at = now(), deleted_by = $2::uuid
             WHERE id = $1::uuid AND deleted_at IS NULL`,
            target.id,
            auth.principal.id,
          );
        },
        { maxWait: 30_000, timeout: 120_000 },
      );

      // Soft delete alone would leave the session working. C-3.6 requires access
      // to end immediately, so the auth account is disabled too: the refresh
      // token is revoked and the access token is rejected on its next use.
      await disableAuthAccount(target.auth_user_id);

      return empty(204);
    },
  },
});
