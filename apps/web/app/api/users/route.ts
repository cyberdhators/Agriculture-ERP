import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  createUserSchema,
  decodeCursor,
  encodeCursor,
  toIso,
} from '@agri-erp/shared';

import { countOrphanAuthAccounts } from '../../../lib/api/orphans';
import { conflict, invalidCursor, unprocessable } from '../../../lib/api/errors';
import { created, defineRoutes, paged } from '../../../lib/api/route';
import { requireWriter } from '../../../lib/api/scope';
import { prisma } from '../../../lib/db';
import { createAuthAccount, deleteAuthAccount } from '../../../lib/supabase/admin';

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

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  /**
   * The staff list. An admin sees everyone; a supervisor or read_only sees
   * accounts scoped to their own state.
   *
   * An admin has no state, so a supervisor cannot see or enumerate
   * administrators. That follows from "a null scope never means everything" and
   * is the safer reading.
   */
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ request, auth }) => {
      const url = new URL(request.url);
      const rawLimit = url.searchParams.get('limit');
      const rawCursor = url.searchParams.get('cursor');

      let limit = DEFAULT_LIMIT;
      if (rawLimit !== null) {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1) throw invalidCursor();
        // Asking for too much is not an error -- CONVENTIONS section 6.
        limit = Math.min(parsed, MAX_LIMIT);
      }

      const where: string[] = [];
      const params: unknown[] = [];
      if (auth.scope.kind === 'state') {
        params.push(auth.scope.stateId);
        where.push(`scope_state_id = $${params.length}`);
      }

      if (rawCursor !== null) {
        const cursor = decodeCursor(rawCursor);
        // Not silently treated as page one. CONVENTIONS section 6.
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      // One more than asked for, to know whether another page exists without a
      // second count query.
      const rows = await prisma.$queryRawUnsafe<UserRow[]>(
        `SELECT id, auth_user_id, name, role::text AS role, scope_state_id, last_login_at, created_at
         FROM public.user_active
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC, id DESC
         LIMIT ${limit + 1}`,
        ...params,
      );

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];

      const cursor =
        hasMore && last ? encodeCursor({ createdAt: toIso(last.created_at), id: last.id }) : null;

      // An administrator, on the first page only: counting orphans is a scan of
      // every authentication account, and a supervisor has no business knowing
      // about accounts outside their state. Reported rather than hidden -- the
      // compensating transaction can leave residue. See docs/DECISIONS.md.
      let orphanAuthAccounts: number | undefined;
      if (auth.role === 'admin' && rawCursor === null) {
        // A failure here must not fail the list; the count is diagnostic.
        orphanAuthAccounts = await countOrphanAuthAccounts().catch(() => undefined);
      }

      return paged(page.map(present), {
        cursor,
        hasMore,
        ...(orphanAuthAccounts === undefined ? {} : { orphan_auth_accounts: orphanAuthAccounts }),
      });
    },
  },

  /**
   * Creates a staff account. Administrators only -- C-3.1, there is no
   * self-signup.
   *
   * The auth account and the row are created as a COMPENSATING TRANSACTION, not
   * a real one: Supabase Auth is a separate service over HTTP and a Postgres
   * transaction cannot roll back an HTTP call. If the row fails, the auth
   * account is deleted. Reasoning and the residual failure are in
   * docs/DECISIONS.md.
   */
  POST: {
    roles: ['admin'],
    bodySchema: createUserSchema,
    handler: async ({ auth, body }) => {
      requireWriter(auth);

      if (body.state_id) {
        const [state] = await prisma.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM public.state_active WHERE id = $1',
          body.state_id,
        );
        if (!state) throw unprocessable('state_not_found');
      }

      let authUserId: string;
      try {
        authUserId = await createAuthAccount(body.email, body.password);
      } catch {
        // The address is already taken, or Auth refused. Either way the caller
        // gets one sentence and no detail about which accounts exist.
        throw conflict('account_already_exists');
      }

      try {
        const [row] = await prisma.$queryRawUnsafe<UserRow[]>(
          `INSERT INTO public."user" (auth_user_id, name, role, scope_state_id)
           VALUES ($1::uuid, $2, $3::public.user_role, $4)
           RETURNING id, auth_user_id, name, role::text AS role, scope_state_id, last_login_at, created_at`,
          authUserId,
          body.name,
          body.role,
          body.state_id ?? null,
        );
        return created(present(row as UserRow));
      } catch (failure) {
        // Compensate. If THIS fails too, an orphan auth account remains: it can
        // authenticate, requireRole finds no row, and it gets 401. Fails closed,
        // and the list below surfaces it.
        await deleteAuthAccount(authUserId).catch(() => undefined);
        throw failure;
      }
    },
  },
});
