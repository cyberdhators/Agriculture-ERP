import { randomUUID } from 'node:crypto';

import { analyticsExportSchema, resolveAnalyticsWindow } from '@agri-erp/shared';

import { analyticsStates } from '../../../../lib/analytics/scope';
import { analyticsSheets } from '../../../../lib/analytics/workbook';
import { XLSX_CONTENT_TYPE, buildXlsx } from '../../../../lib/analytics/xlsx';
import { analyticsSummary } from '../../../../lib/api/analytics';
import { audited, writeAudit } from '../../../../lib/api/audit';
import { forbidden } from '../../../../lib/api/errors';
import { requirePermissionCoverage } from '../../../../lib/api/permissions';
import { defineRoutes, streamed } from '../../../../lib/api/route';
import { requireWriter } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * POST /api/analytics/export -- the analytics figures as an Excel workbook
 * (2026-10-22): a Summary sheet, one sheet per breakdown and a Definitions
 * sheet carrying the generation time, the filters, the cut-off and the
 * limitations. Body: `{ filters?: { from, to, state_id } }`, the page's own.
 *
 * Roles: admin and supervisor, with `reports.view` -- the same roles as the
 * reports export. Exporting is recorded, and a read-only user creates no
 * records (C-3.9). Aggregated counts only: nothing in the file identifies a
 * person, so `exports.identifiable` is not asked for.
 *
 * EVERY EXPORT IS LOGGED (CLAUDE.md, Reporting): who, the filters, the scope,
 * the cut-off, each query as it ran and the row count of each sheet, in an
 * `analytics.exported` audit row written BEFORE the file is returned. If the
 * record cannot be written, no file leaves. The reports export table is not
 * reused: its report_type CHECK admits only 'summary' and 'farmers', and
 * widening it would need a migration.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: analyticsExportSchema,
    handler: async ({ auth, body, deviceId }) => {
      requireWriter(auth);
      const { coverage } = await requirePermissionCoverage(auth, 'reports.view');
      const filters = body.filters ?? {};
      const states = analyticsStates(auth.scope, coverage, filters.state_id, forbidden);
      const window = resolveAnalyticsWindow(filters);
      const { summary, queries } = await analyticsSummary(
        prisma,
        window,
        states,
        filters.state_id ?? null,
      );

      const named = states
        ? await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
            `SELECT id, name FROM public.state WHERE id = ANY($1::text[]) ORDER BY name`,
            states,
          )
        : [];
      const nameOf = (id: string) => named.find((s) => s.id === id)?.name ?? id;
      const sheets = analyticsSheets(summary, {
        stateLabel: filters.state_id ? nameOf(filters.state_id) : 'All states in scope',
        scopeLabel: states ? states.map(nameOf).join(', ') : 'National',
      });
      const bytes = buildXlsx(sheets, new Date(summary.generated_at));
      const exportId = randomUUID();

      await audited(prisma, (tx) =>
        writeAudit(tx, {
          entityType: 'analytics_export',
          entityId: exportId,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'analytics.exported',
          deviceId,
          after: {
            format: 'xlsx',
            filters,
            window_from: window.from,
            window_to: window.to,
            data_cutoff: window.to,
            scope_states: states,
            generated_at: summary.generated_at,
            row_counts: Object.fromEntries(sheets.map((s) => [s.name, s.rows.length])),
            query: queries.map((q) => `-- ${q.id}\n${q.sql}`).join(';\n'),
          },
        }),
      );

      const body$ = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      return streamed(body$, {
        'content-type': XLSX_CONTENT_TYPE,
        'content-disposition': `attachment; filename="agrione-analytics-${window.from}-to-${window.to}.xlsx"`,
        'content-length': String(bytes.length),
        'x-export-id': exportId,
        'cache-control': 'no-store',
      });
    },
  },
});
