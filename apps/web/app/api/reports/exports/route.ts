import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  decodeCursor,
  encodeCursor,
  exportListFilterSchema,
  exportRequestSchema,
  toIso,
  zodErrorToApiError,
} from '@agri-erp/shared';
import { audited, writeAudit } from '../../../../lib/api/audit';
import { ApiFailure, invalidCursor } from '../../../../lib/api/errors';
import { farmersExport, resolveFilter, summaryReport } from '../../../../lib/api/reporting';
import { created, defineRoutes, paged } from '../../../../lib/api/route';
import { requireWriter } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

interface ExportRow {
  id: string;
  exported_by: string;
  actor_type: string;
  report_type: string;
  query: string;
  filters: unknown;
  scope: unknown;
  data_cutoff: Date;
  row_count: number;
  exported_at: Date;
}

const presentExport = (e: ExportRow) => ({
  id: e.id,
  exported_by: e.exported_by,
  actor_type: e.actor_type,
  report_type: e.report_type,
  query: e.query,
  filters: e.filters,
  scope: e.scope,
  data_cutoff: toIso(e.data_cutoff).slice(0, 10),
  row_count: e.row_count,
  exported_at: toIso(e.exported_at),
});

/**
 * POST /api/reports/exports — runs a report with the same builder the
 * dashboard uses and records it: who, the query as it ran, the filters, the
 * scope, the cut-off and the row count (C-10.8, C-10.9). Administrators and
 * supervisors; a read-only user reads the dashboard and does not create
 * records (C-3.9). The farmer list carries farmer numbers only (C-10.11).
 *
 * GET — the export log, newest first: an administrator sees all, a
 * supervisor their state's.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor'],
    handler: async ({ auth, request }) => {
      const parsed = exportListFilterSchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success) {
        const { body } = zodErrorToApiError(parsed.error);
        throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
      }
      let limit = DEFAULT_LIMIT;
      if (parsed.data.limit !== undefined) {
        const n = Number(parsed.data.limit);
        if (!Number.isInteger(n) || n < 1) throw invalidCursor();
        limit = Math.min(n, MAX_LIMIT);
      }
      const params: unknown[] = [];
      const where: string[] = [];
      if (auth.scope.kind === 'state') {
        params.push(auth.scope.stateId);
        where.push(`e.scope->>'state_id' = $${params.length}`);
      }
      if (parsed.data.cursor !== undefined) {
        const cursor = decodeCursor(parsed.data.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(e.exported_at, e.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }
      const rows = await prisma.$queryRawUnsafe<ExportRow[]>(
        `SELECT e.id, e.exported_by, e.actor_type::text AS actor_type, e.report_type, e.query, e.filters, e.scope,
                e.data_cutoff, e.row_count, e.exported_at
         FROM public.report_export e ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY e.exported_at DESC, e.id DESC LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(page.map(presentExport), {
        cursor:
          hasMore && last
            ? encodeCursor({ createdAt: toIso(last.exported_at), id: last.id })
            : null,
        hasMore,
      });
    },
  },
  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: exportRequestSchema,
    handler: async ({ auth, body }) => {
      requireWriter(auth);
      const filters = body.filters ?? {};
      const resolved = resolveFilter(filters);
      const scope =
        auth.scope.kind === 'state'
          ? { kind: 'state', state_id: auth.scope.stateId }
          : auth.scope.kind === 'caseload'
            ? { kind: 'caseload', officer_id: auth.scope.officerId }
            : { kind: 'all' };

      let data: unknown;
      let query: string;
      let rowCount: number;
      if (body.report_type === 'summary') {
        const { summary, queries } = await summaryReport(prisma, auth, filters);
        data = summary;
        query = queries.join(';\n');
        rowCount = 1;
      } else {
        const result = await farmersExport(prisma, auth, filters);
        data = result.rows.map((r) => ({ ...r, registered_at: toIso(r.registered_at) }));
        query = result.query;
        rowCount = result.rows.length;
      }

      const row = await audited(prisma, async (tx) => {
        const [inserted] = await tx.$queryRawUnsafe<ExportRow[]>(
          `INSERT INTO public.report_export
             (exported_by, actor_type, report_type, query, filters, scope, data_cutoff, row_count)
           VALUES ($1::uuid, $2::public.audit_actor_type, $3, $4, $5::jsonb, $6::jsonb, $7::date, $8)
           RETURNING id, exported_by, actor_type::text AS actor_type, report_type, query, filters, scope,
                     data_cutoff, row_count, exported_at`,
          auth.principal.id,
          auth.role,
          body.report_type,
          query,
          JSON.stringify(filters),
          JSON.stringify(scope),
          resolved.cutoffDate,
          rowCount,
        );
        if (!inserted) throw new Error('export log returned no row');
        await writeAudit(tx, {
          entityType: 'report_export',
          entityId: inserted.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'report.exported',
          after: {
            report_type: body.report_type,
            data_cutoff: resolved.cutoffDate,
            row_count: rowCount,
            scope,
          },
        });
        return inserted;
      });
      return created({ export: presentExport(row), data });
    },
  },
});
