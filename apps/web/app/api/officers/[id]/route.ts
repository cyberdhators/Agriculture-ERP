import { patchOfficerSchema, toIso } from '@agri-erp/shared';

import { notFound, unprocessable } from '../../../../lib/api/errors';
import { defineRoutes, empty, ok } from '../../../../lib/api/route';
import { requireWriter } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';
import {
  disableAuthAccount,
  enableAuthAccount,
  setAuthPassword,
} from '../../../../lib/supabase/admin';

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

/**
 * Loads an officer the caller may see, or 404.
 *
 * Reads the BASE table, not officer_active, because an administrator must be
 * able to see and re-activate an officer they set inactive. C-3.6 ends that
 * officer's ACCESS; it does not hide them from administration. Soft-deleted
 * rows stay invisible.
 *
 * Out of scope and does-not-exist are the same response. C-3.5.
 */
async function loadVisible(
  id: string,
  scope: { stateId?: string; officerId?: string },
): Promise<OfficerRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();

  const conditions: string[] = ['id = $1::uuid', 'deleted_at IS NULL'];
  const params: unknown[] = [id];
  if (scope.stateId) {
    params.push(scope.stateId);
    conditions.push(`state_id = $${params.length}`);
  }
  if (scope.officerId) {
    params.push(scope.officerId);
    conditions.push(`id = $${params.length}::uuid`);
  }

  const [row] = await prisma.$queryRawUnsafe<OfficerRow[]>(
    `SELECT id, auth_user_id, name, phone, payam_id, state_id, status::text AS status,
            last_sync_at, created_at
     FROM public."officer" WHERE ${conditions.join(' AND ')}`,
    ...params,
  );
  if (!row) throw notFound();
  return row;
}

const scopeOf = (auth: { scope: { kind: string; stateId?: string; officerId?: string } }) =>
  auth.scope.kind === 'state'
    ? { stateId: auth.scope.stateId }
    : auth.scope.kind === 'caseload'
      ? { officerId: auth.scope.officerId }
      : {};

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ auth, params }) =>
      ok(present(await loadVisible(params.id ?? '', scopeOf(auth)))),
  },

  PATCH: {
    roles: ['admin'],
    bodySchema: patchOfficerSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const target = await loadVisible(params.id ?? '', {});

      let payamId = target.payam_id;
      let stateId = target.state_id;
      if (body.payam_id && body.payam_id !== target.payam_id) {
        const [payam] = await prisma.$queryRawUnsafe<{ id: string; state_id: string }[]>(
          'SELECT id, state_id FROM public.payam_active WHERE id = $1',
          body.payam_id,
        );
        if (!payam) throw unprocessable('payam_not_found');
        payamId = payam.id;
        // Moved with the payam, so the two cannot disagree.
        stateId = payam.state_id;
      }

      const [row] = await prisma.$queryRawUnsafe<OfficerRow[]>(
        `UPDATE public."officer"
         SET name = COALESCE($2, name),
             payam_id = $3, state_id = $4,
             status = COALESCE($5::public.officer_status, status)
         WHERE id = $1::uuid AND deleted_at IS NULL
         RETURNING id, auth_user_id, name, phone, payam_id, state_id, status::text AS status,
                   last_sync_at, created_at`,
        target.id,
        body.name ?? null,
        payamId,
        stateId,
        body.status ?? null,
      );
      if (!row) throw notFound();

      // C-3.6: inactive ends access immediately, by the same mechanism as soft
      // deletion. And re-activating restores it -- otherwise inactive is
      // one-way and an administrator cannot undo their own mistake.
      if (body.status === 'inactive') await disableAuthAccount(target.auth_user_id);
      if (body.status === 'active') await enableAuthAccount(target.auth_user_id);

      if (body.password) await setAuthPassword(target.auth_user_id, body.password);

      return ok(present(row as OfficerRow));
    },
  },

  DELETE: {
    roles: ['admin'],
    handler: async ({ auth, params }) => {
      requireWriter(auth);
      const target = await loadVisible(params.id ?? '', {});

      await prisma.$executeRawUnsafe(
        `UPDATE public."officer" SET deleted_at = now(), deleted_by = $2::uuid
         WHERE id = $1::uuid AND deleted_at IS NULL`,
        target.id,
        auth.principal.id,
      );

      await disableAuthAccount(target.auth_user_id);
      return empty(204);
    },
  },
});
