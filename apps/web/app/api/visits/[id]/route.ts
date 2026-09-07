import { correctVisitSchema, toIso } from '@agri-erp/shared';
import { audited, writeAudit } from '../../../../lib/api/audit';
import { forbidden, notFound, unprocessable } from '../../../../lib/api/errors';
import { defineRoutes, empty, ok } from '../../../../lib/api/route';
import { requireWriter } from '../../../../lib/api/scope';
import {
  VISIT_COLUMNS,
  type VisitRow,
  attachmentsOf,
  checkFollowUp,
  loadVisibleVisit,
  presentVisit,
  visitAuditFields,
  withinCorrectionWindow,
} from '../../../../lib/api/visits';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/visits/:id — scoped, position per the B8 visibility rule.
 * PATCH — a correction (C-8.10): the visit's own officer within twenty-four
 * hours of the SERVER's moment, an administrator at any time. What may change
 * is what the schema admits; the farmer, the officer, the position and both
 * moments are not in it, and the database refuses them too.
 * DELETE — administrator, soft (C-8.11).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ auth, params }) => {
      const visit = await loadVisibleVisit(prisma, params.id ?? '', auth);
      const attachments = await attachmentsOf(prisma, [visit.id]);
      return ok(presentVisit(visit, attachments, auth));
    },
  },
  PATCH: {
    roles: ['admin', 'officer'],
    bodySchema: correctVisitSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const visit = await loadVisibleVisit(prisma, params.id ?? '', auth);
      if (auth.role === 'officer') {
        if (visit.officer_id !== auth.principal.id) throw forbidden();
        if (!withinCorrectionWindow(visit.received_at)) {
          throw unprocessable('correction_window_closed');
        }
      }
      const row = await audited(prisma, async (tx) => {
        if (body.follow_up_of)
          await checkFollowUp(tx, visit.farmer_id, visit.id, body.follow_up_of);
        const sets: string[] = [];
        const values: unknown[] = [visit.id];
        const set = (column: string, cast: string, value: unknown) => {
          values.push(value);
          sets.push(`${column} = $${values.length}${cast}`);
        };
        if ('observation' in body) set('observation', '', body.observation ?? null);
        if (body.advice !== undefined) set('advice', '', body.advice);
        if (body.topics !== undefined) set('topics', '::public.visit_topic[]', body.topics);
        if ('duration_minutes' in body) set('duration_minutes', '', body.duration_minutes ?? null);
        if ('attendee_count' in body) set('attendee_count', '', body.attendee_count ?? null);
        if ('follow_up_of' in body) set('follow_up_of', '::uuid', body.follow_up_of ?? null);
        sets.push('updated_at = now()');
        const [updated] = await tx.$queryRawUnsafe<VisitRow[]>(
          `WITH v AS (
             UPDATE public.visit SET ${sets.join(', ')}
             WHERE id = $1::uuid AND deleted_at IS NULL RETURNING *
           )
           SELECT ${VISIT_COLUMNS} FROM v JOIN public.farmer fr ON fr.id = v.farmer_id`,
          ...values,
        );
        if (!updated) throw notFound();
        // Changed fields only, and never the substance: the log records THAT
        // the advice changed, never what it said (C-8.12, C-8.13).
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        const fields = visitAuditFields(visit);
        const fieldsAfter = visitAuditFields(updated);
        for (const key of Object.keys(fieldsAfter)) {
          if (JSON.stringify(fields[key]) !== JSON.stringify(fieldsAfter[key])) {
            before[key] = fields[key];
            after[key] = fieldsAfter[key];
          }
        }
        if (body.advice !== undefined && body.advice !== visit.advice) {
          before.advice_changed = false;
          after.advice_changed = true;
        }
        if ('observation' in body && (body.observation ?? null) !== visit.observation) {
          before.observation_changed = false;
          after.observation_changed = true;
        }
        await writeAudit(tx, {
          entityType: 'visit',
          entityId: visit.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'visit.corrected',
          before,
          after,
        });
        return updated;
      });
      const attachments = await attachmentsOf(prisma, [row.id]);
      return ok(presentVisit(row, attachments, auth));
    },
  },
  DELETE: {
    roles: ['admin'],
    handler: async ({ auth, params }) => {
      requireWriter(auth);
      const visit = await loadVisibleVisit(prisma, params.id ?? '', auth);
      await audited(prisma, async (tx) => {
        const [row] = await tx.$queryRawUnsafe<{ deleted_at: Date }[]>(
          `UPDATE public.visit SET deleted_at = now(), deleted_by = $2::uuid
           WHERE id = $1::uuid AND deleted_at IS NULL RETURNING deleted_at`,
          visit.id,
          auth.principal.id,
        );
        if (!row) throw notFound();
        await writeAudit(tx, {
          entityType: 'visit',
          entityId: visit.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'visit.soft_deleted',
          before: { deleted_at: null },
          after: { deleted_at: toIso(row.deleted_at) },
        });
      });
      return empty(204);
    },
  },
});
