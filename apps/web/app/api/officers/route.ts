import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  createOfficerSchema,
  decodeCursor,
  encodeCursor,
  officerAuthIdentifier,
  toIso,
} from '@agri-erp/shared';

import { conflict, invalidCursor, unprocessable } from '../../../lib/api/errors';
import { created, defineRoutes, paged } from '../../../lib/api/route';
import { requireWriter } from '../../../lib/api/scope';
import { prisma } from '../../../lib/db';
import { createAuthAccount, deleteAuthAccount } from '../../../lib/supabase/admin';

interface OfficerRow {
  id: string;
  auth_user_id: string;
  name: string;
  phone: string;
  payam_id: string;
  state_id: string;
  status: string;
  last_sync_at: Date | null;
  created_at: Date;
}

/** The derived authentication identifier is never returned. It is not a field. */
const present = (row: OfficerRow) => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  payam_id: row.payam_id,
  state_id: row.state_id,
  status: row.status,
  last_sync_at: row.last_sync_at ? toIso(row.last_sync_at) : null,
  created_at: toIso(row.created_at),
});

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  /**
   * The officer list. An admin sees all; a supervisor or read_only sees officers
   * in their state; an officer sees only themselves -- their caseload is what
   * they registered, and the only officer record they registered is none, so
   * they are given their own row and nothing else.
   */
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ request, auth }) => {
      const url = new URL(request.url);
      const rawLimit = url.searchParams.get('limit');
      const rawCursor = url.searchParams.get('cursor');

      let limit = DEFAULT_LIMIT;
      if (rawLimit !== null) {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1) throw invalidCursor();
        limit = Math.min(parsed, MAX_LIMIT);
      }

      const where: string[] = [];
      const params: unknown[] = [];
      if (auth.scope.kind === 'state') {
        params.push(auth.scope.stateId);
        where.push(`state_id = $${params.length}`);
      } else if (auth.scope.kind === 'caseload') {
        params.push(auth.scope.officerId);
        where.push(`id = $${params.length}::uuid`);
      }

      if (rawCursor !== null) {
        const cursor = decodeCursor(rawCursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<OfficerRow[]>(
        `SELECT id, auth_user_id, name, phone, payam_id, state_id, status::text AS status,
                last_sync_at, created_at
         FROM public.officer_active
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC, id DESC
         LIMIT ${limit + 1}`,
        ...params,
      );

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];

      return paged(page.map(present), {
        cursor:
          hasMore && last ? encodeCursor({ createdAt: toIso(last.created_at), id: last.id }) : null,
        hasMore,
      });
    },
  },

  /**
   * Creates an officer. Administrators only.
   *
   * The officer types a phone number and a password. Underneath, the auth
   * account is keyed by the DERIVED identifier -- see docs/DECISIONS.md. The
   * officer row stores the real E.164 phone; the identifier is not stored.
   */
  POST: {
    roles: ['admin'],
    bodySchema: createOfficerSchema,
    handler: async ({ auth, body }) => {
      requireWriter(auth);

      // The payam must exist, and it supplies the state so the two cannot
      // disagree -- the composite key would refuse them anyway, as a 500.
      const [payam] = await prisma.$queryRawUnsafe<{ id: string; state_id: string }[]>(
        'SELECT id, state_id FROM public.payam_active WHERE id = $1',
        body.payam_id,
      );
      if (!payam) throw unprocessable('payam_not_found');

      const [taken] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        'SELECT id FROM public."officer" WHERE phone = $1',
        body.phone,
      );
      if (taken) throw conflict('phone_already_registered');

      let authUserId: string;
      try {
        authUserId = await createAuthAccount(officerAuthIdentifier(body.phone), body.password);
      } catch {
        throw conflict('phone_already_registered');
      }

      try {
        const [row] = await prisma.$queryRawUnsafe<OfficerRow[]>(
          `INSERT INTO public."officer" (auth_user_id, name, phone, payam_id, state_id)
           VALUES ($1::uuid, $2, $3, $4, $5)
           RETURNING id, auth_user_id, name, phone, payam_id, state_id, status::text AS status,
                     last_sync_at, created_at`,
          authUserId,
          body.name,
          body.phone,
          payam.id,
          payam.state_id,
        );
        return created(present(row as OfficerRow));
      } catch (failure) {
        await deleteAuthAccount(authUserId).catch(() => undefined);
        throw failure;
      }
    },
  },
});
