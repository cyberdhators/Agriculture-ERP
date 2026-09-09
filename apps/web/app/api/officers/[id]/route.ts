import { patchOfficerSchema, toIso } from '@agri-erp/shared';

import { audited, writeAudit, writeAuditOutcome } from '../../../../lib/api/audit';
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

      const actor = { actorType: auth.role, actorId: auth.principal.id } as const;
      const statusChanging = body.status !== undefined && body.status !== target.status;

      const row = await audited(prisma, async (tx) => {
        const [updated] = await tx.$queryRawUnsafe<OfficerRow[]>(
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
        if (!updated) throw notFound();
        const next = updated as OfficerRow;

        // An edit and a deactivation are different rows (DECISIONS): "who cut
        // off this officer's access" must be answerable without diffing JSON.
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const [key, was, now] of [
          ['name', target.name, next.name],
          ['payam_id', target.payam_id, next.payam_id],
          ['state_id', target.state_id, next.state_id],
        ] as const) {
          if (was !== now) {
            before[key] = was;
            after[key] = now;
          }
        }
        if (Object.keys(after).length > 0) {
          await writeAudit(tx, {
            entityType: 'officer',
            entityId: next.id,
            ...actor,
            action: 'officer.updated',
            before,
            after,
          });
        }
        if (statusChanging) {
          await writeAudit(tx, {
            entityType: 'officer',
            entityId: next.id,
            ...actor,
            action: 'officer.status_changed',
            before: { status: target.status },
            after: { status: next.status },
          });
        }
        return next;
      });

      // The auth side of a status change is an HTTP call with no transaction.
      // Its audit row records the OUTCOME after the call returns (C-4.4 note).
      const outcome = { entityType: 'officer', entityId: target.id, ...actor } as const;
      if (statusChanging && body.status === 'inactive') {
        try {
          await disableAuthAccount(target.auth_user_id);
          await writeAuditOutcome({ ...outcome, action: 'auth.disabled' });
        } catch (failure) {
          await writeAuditOutcome({ ...outcome, action: 'auth.disable_failed' }).catch(
            () => undefined,
          );
          throw failure;
        }
      }
      if (statusChanging && body.status === 'active') {
        try {
          await enableAuthAccount(target.auth_user_id);
        } catch (failure) {
          // The database already says active; access was not restored. Rather
          // than let the log say something the world does not, flip the row
          // back and record the flip -- no new action key needed, and the log
          // reads exactly what happened: active, then inactive again.
          await audited(prisma, async (tx) => {
            await tx.$executeRawUnsafe(
              `UPDATE public."officer" SET status = 'inactive' WHERE id = $1::uuid`,
              target.id,
            );
            await writeAudit(tx, {
              ...outcome,
              action: 'officer.status_changed',
              before: { status: 'active' },
              after: { status: 'inactive' },
            });
          });
          throw failure;
        }
      }

      if (body.password) {
        await setAuthPassword(target.auth_user_id, body.password);
        // Never the password itself: before and after are null (C-4.6).
        await writeAuditOutcome({
          ...outcome,
          action: 'officer.password_set',
          before: null,
          after: null,
        });
      }

      // C-8R.3 addition (owner): the act that leaves farmers without a working
      // officer says how many. Not a refusal, not a field on the officer record
      // — a number in the response to the deactivation itself.
      if (statusChanging && body.status === 'inactive') {
        const [count] = await prisma.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM public.farmer WHERE caseload_officer_id = $1::uuid AND deleted_at IS NULL`,
          target.id,
        );
        return ok({ ...present(row), unassigned_farmers: count?.n ?? 0 });
      }
      return ok(present(row));
    },
  },

  DELETE: {
    roles: ['admin'],
    handler: async ({ auth, params }) => {
      requireWriter(auth);
      const target = await loadVisible(params.id ?? '', {});

      const actor = { actorType: auth.role, actorId: auth.principal.id } as const;
      await audited(prisma, async (tx) => {
        const [row] = await tx.$queryRawUnsafe<{ deleted_at: Date }[]>(
          `UPDATE public."officer" SET deleted_at = now(), deleted_by = $2::uuid
           WHERE id = $1::uuid AND deleted_at IS NULL RETURNING deleted_at`,
          target.id,
          auth.principal.id,
        );
        if (!row) throw notFound();
        await writeAudit(tx, {
          entityType: 'officer',
          entityId: target.id,
          ...actor,
          action: 'officer.soft_deleted',
          before: { deleted_at: null },
          after: { deleted_at: toIso(row.deleted_at) },
        });
      });

      // Two rows for a delete, not one (DECISIONS): the auth disable is a
      // separate system that can fail on its own, and the log says which.
      const outcome = { entityType: 'officer', entityId: target.id, ...actor } as const;
      try {
        await disableAuthAccount(target.auth_user_id);
        await writeAuditOutcome({ ...outcome, action: 'auth.disabled' });
      } catch (failure) {
        await writeAuditOutcome({ ...outcome, action: 'auth.disable_failed' }).catch(
          () => undefined,
        );
        throw failure;
      }
      return empty(204);
    },
  },
});
