import {
  caseTransition,
  isSettledStatus,
  supportCaseUpdateSchema,
  type StoredSupportStatus,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../lib/api/errors';
import { notifyAccount } from '../../../../../lib/api/notify';
import { requirePermission } from '../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import {
  ASSIGNABLE_STAFF_SQL,
  CASE_ENTRY_SELECT,
  SUPPORT_CASE_SELECT,
  presentEntry,
  presentSupport,
  type CaseEntryRow,
  type SupportRow,
} from '../../../../../lib/api/support';
import { prisma } from '../../../../../lib/db';

/**
 * ONE SUPPORT CASE (2026-10-21 as a message; a case since 2026-10-28, the
 * specification's line 103). ADMINISTRATOR ONLY, and then `support.handle`.
 *
 * GET -- the case, everything staff added to it (replies, internal notes,
 * evidence links, oldest first), and the staff who may be made responsible.
 *
 * PATCH -- change its status, type, priority, responsible staff member or
 * resolution note, in one audited transaction. The status rules are
 * `caseTransition` in packages/shared (pure, tested): never back to new;
 * resolving or closing needs a resolution note; a settled case may be
 * reopened, which clears who settled it. Resolving or closing tells a
 * signed-in sender with a FIXED in-app notice (never the note's text). A
 * change that changes nothing writes no audit row and answers with the case.
 *
 * The audit row names the fields that changed with their new values, except
 * the resolution note, which is recorded only as written: it is staff's free
 * text about a person.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LockedCase {
  status: StoredSupportStatus;
  case_type: string | null;
  priority: string;
  assignee_id: string | null;
  resolution_note: string | null;
  from_auth_user_id: string | null;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ auth, params }) => {
      await requirePermission(auth, 'support.handle');
      const id = params.id ?? '';
      if (!UUID.test(id)) throw notFound();
      const [row] = await prisma.$queryRawUnsafe<SupportRow[]>(SUPPORT_CASE_SELECT, id);
      if (!row) throw notFound();
      const entries = await prisma.$queryRawUnsafe<CaseEntryRow[]>(CASE_ENTRY_SELECT, id);
      const assignable =
        await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(ASSIGNABLE_STAFF_SQL);
      return ok(
        { ...presentSupport(row), entries: entries.map(presentEntry), assignable },
        { 'cache-control': 'no-store' },
      );
    },
  },

  PATCH: {
    roles: ['admin'],
    bodySchema: supportCaseUpdateSchema,
    handler: async ({ auth, body, params }) => {
      await requirePermission(auth, 'support.handle');
      const id = params.id ?? '';
      if (!UUID.test(id)) throw notFound();

      const row = await audited(prisma, async (tx) => {
        const [current] = await tx.$queryRawUnsafe<LockedCase[]>(
          `SELECT status, case_type, priority, assignee_id, resolution_note, from_auth_user_id
             FROM public.support_message
            WHERE id = $1::uuid AND deleted_at IS NULL
            FOR UPDATE`,
          id,
        );
        if (!current) throw notFound();

        const sets: string[] = [];
        const values: unknown[] = [id];
        const set = (column: string, value: unknown, cast = '') => {
          values.push(value);
          sets.push(`${column} = $${values.length}${cast}`);
        };
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};

        if (body.assignee_id !== undefined && body.assignee_id !== current.assignee_id) {
          if (body.assignee_id !== null) {
            const staff = await tx.$queryRawUnsafe<{ id: string }[]>(
              `SELECT id FROM (${ASSIGNABLE_STAFF_SQL}) s WHERE s.id = $1::uuid`,
              body.assignee_id,
            );
            if (staff.length === 0) throw unprocessable('support_case_assignee_not_staff');
          }
          set('assignee_id', body.assignee_id, '::uuid');
          before.assignee_id = current.assignee_id;
          after.assignee_id = body.assignee_id;
        }
        if (body.case_type !== undefined && body.case_type !== current.case_type) {
          set('case_type', body.case_type);
          before.case_type = current.case_type;
          after.case_type = body.case_type;
        }
        if (body.priority !== undefined && body.priority !== current.priority) {
          set('priority', body.priority);
          before.priority = current.priority;
          after.priority = body.priority;
        }
        if (
          body.resolution_note !== undefined &&
          body.resolution_note !== current.resolution_note
        ) {
          set('resolution_note', body.resolution_note);
          before.resolution_note = current.resolution_note === null ? null : 'written';
          after.resolution_note = 'written';
        }

        let settles = false;
        if (body.status !== undefined) {
          const hasNote = (body.resolution_note ?? current.resolution_note) !== null;
          const move = caseTransition(current.status, body.status, hasNote);
          if (!move.ok) throw unprocessable(move.rule);
          if (!move.same) {
            set('status', body.status);
            if (move.settles && !isSettledStatus(current.status)) {
              set('handled_by', auth.principal.id, '::uuid');
              sets.push('handled_at = now()');
            } else if (move.reopens) {
              sets.push('handled_by = NULL', 'handled_at = NULL');
            }
            before.status = current.status;
            after.status = body.status;
            settles = move.settles;
          }
        }

        if (sets.length > 0) {
          await tx.$executeRawUnsafe(
            `UPDATE public.support_message SET ${sets.join(', ')}, updated_at = now()
              WHERE id = $1::uuid`,
            ...values,
          );
          await writeAudit(tx, {
            entityType: 'support_message',
            entityId: id,
            actorType: auth.role,
            actorId: auth.principal.id,
            action: 'support_case.updated',
            before,
            after,
          });
          if (settles && current.from_auth_user_id) {
            await notifyAccount(
              tx,
              { authUserId: current.from_auth_user_id },
              'support_case_updated',
              {
                actorType: auth.role,
                actorId: auth.principal.id,
              },
            );
          }
        }

        const [fresh] = await tx.$queryRawUnsafe<SupportRow[]>(SUPPORT_CASE_SELECT, id);
        if (!fresh) throw notFound();
        return fresh;
      });

      return ok(presentSupport(row));
    },
  },
});
