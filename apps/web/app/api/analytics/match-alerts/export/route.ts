import { randomUUID } from 'node:crypto';

import { matchAlertExportSchema, resolveAnalyticsWindow } from '@agri-erp/shared';

import { matchAlertSheets } from '../../../../../lib/analytics/match-alert-workbook';
import { analyticsStates } from '../../../../../lib/analytics/scope';
import { XLSX_CONTENT_TYPE, buildXlsx } from '../../../../../lib/analytics/xlsx';
import { audited, writeAudit } from '../../../../../lib/api/audit';
import { forbidden } from '../../../../../lib/api/errors';
import { matchAlertReport } from '../../../../../lib/api/match-alert-report';
import { requirePermissionCoverage } from '../../../../../lib/api/permissions';
import { defineRoutes, streamed } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/analytics/match-alerts/export -- the match-alert results as an
 * Excel workbook (2026-11-03), consistent with the analytics export: a
 * Summary sheet, a By source sheet and an Over time sheet, each with an
 * editable chart, and a Definitions sheet with the filters, the generation
 * time, every metric's window, denominator and source, and the limitations.
 * Body: `{ filters?: { from, to, state_id, commodity, product, source } }`.
 *
 * Same roles and permission as the page (reports.view). Aggregated counts
 * only, so `exports.identifiable` is not asked for. EVERY EXPORT IS LOGGED
 * before the file leaves (CLAUDE.md, Reporting): an `analytics.exported`
 * audit row with report 'match_alerts', the filters, the scope, the cut-off,
 * the query as it ran and each sheet's row count.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor', 'read_only'],
    bodySchema: matchAlertExportSchema,
    handler: async ({ auth, body, deviceId }) => {
      const { coverage } = await requirePermissionCoverage(auth, 'reports.view');
      const filters = body.filters ?? {};
      const states = analyticsStates(auth.scope, coverage, filters.state_id, forbidden);
      const window = resolveAnalyticsWindow(filters);
      const { report, query } = await matchAlertReport(prisma, window, states, filters);

      const named = states
        ? await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
            `SELECT id, name FROM public.state WHERE id = ANY($1::text[]) ORDER BY name`,
            states,
          )
        : [];
      const nameOf = (id: string) => named.find((s) => s.id === id)?.name ?? id;
      const sheets = matchAlertSheets(report, {
        stateLabel: filters.state_id ? nameOf(filters.state_id) : 'All states in scope',
        scopeLabel: states ? states.map(nameOf).join(', ') : 'National',
      });
      const bytes = buildXlsx(sheets, new Date(report.generated_at));
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
            report: 'match_alerts',
            format: 'xlsx',
            filters,
            window_from: window.from,
            window_to: window.to,
            data_cutoff: window.to,
            scope_states: states,
            generated_at: report.generated_at,
            row_counts: Object.fromEntries(sheets.map((s) => [s.name, s.rows.length])),
            query,
          },
        }),
      );

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      return streamed(stream, {
        'content-type': XLSX_CONTENT_TYPE,
        'content-disposition': `attachment; filename="agrione-match-alerts-${window.from}-to-${window.to}.xlsx"`,
        'content-length': String(bytes.length),
        'x-export-id': exportId,
        'cache-control': 'no-store',
      });
    },
  },
});
