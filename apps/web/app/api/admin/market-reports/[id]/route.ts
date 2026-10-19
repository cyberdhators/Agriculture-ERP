import { moderateReportSchema, toIso, type ModerationAction } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { ApiFailure, notFound } from '../../../../../lib/api/errors';
import {
  MARKET_REPORT_SELECT,
  checkId,
  type MarketReportRow,
} from '../../../../../lib/api/market-posts';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/**
 * One report about a buying request or a service listing, and the decisions
 * an administrator may take on it. ADMINISTRATOR ONLY. LISTINGS LANE
 * (2026-10-19).
 *
 * The state machine of /api/admin/product-reports/:id, unchanged: new ->
 * reviewing -> resolved | dismissed, the last two final. `remove_listing`
 * removes the reported post -- SOFTLY, as the deletion law requires -- and
 * settles the report. The reporter is never returned; the description is,
 * here only, because investigating one report is when it is needed.
 */
const TRANSITIONS: Record<string, readonly string[]> = {
  new: ['reviewing', 'resolved', 'dismissed'],
  reviewing: ['resolved', 'dismissed'],
  resolved: [],
  dismissed: [],
};

const ACTION_STATUS: Record<ModerationAction, string> = {
  mark_reviewing: 'reviewing',
  resolve: 'resolved',
  dismiss: 'dismissed',
  remove_listing: 'resolved',
  suspend_listing: 'reviewing',
};

const TARGET_TABLE: Record<string, string> = {
  buying_request: 'buying_request',
  service_listing: 'service_listing',
};

type Row = MarketReportRow & { description: string | null; resolved_at: Date | null };

const load = async (id: string): Promise<Row> => {
  const [row] = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT q.*, m.description, m.resolved_at
       FROM (${MARKET_REPORT_SELECT} WHERE r.id = $1::uuid) q
       JOIN public.market_report m ON m.id = q.id`,
    checkId(id),
  );
  if (!row) throw notFound();
  return row;
};

const present = (row: Row) => ({
  id: row.id,
  target_type: row.target_type,
  target_id: row.target_id,
  ...(row.target_title === null ? {} : { target_title: row.target_title }),
  ...(row.poster_name === null ? {} : { poster_name: row.poster_name }),
  ...(row.target_status === null ? {} : { target_status: row.target_status }),
  reason: row.reason,
  description: row.description,
  status: row.status,
  created_at: toIso(row.created_at),
  updated_at: toIso(row.updated_at),
  resolved_at: row.resolved_at ? toIso(row.resolved_at) : null,
});

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ params }) => ok(present(await load(params.id ?? ''))),
  },

  PATCH: {
    roles: ['admin'],
    bodySchema: moderateReportSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const row = await load(params.id ?? '');
      const next = ACTION_STATUS[body.action as ModerationAction];
      if (!TRANSITIONS[row.status]?.includes(next)) {
        throw new ApiFailure(
          422,
          'transition_not_allowed',
          'That decision is not available for this report in its current state.',
        );
      }
      const settled = next === 'resolved' || next === 'dismissed';
      await audited(prisma, async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE public.market_report
              SET status = $2::public.report_status,
                  resolved_by = CASE WHEN $3 THEN $4::uuid ELSE resolved_by END,
                  resolved_at = CASE WHEN $3 THEN now() ELSE resolved_at END,
                  updated_at = now()
            WHERE id = $1::uuid AND deleted_at IS NULL`,
          row.id,
          next,
          settled,
          auth.principal.id,
        );
        await writeAudit(tx, {
          entityType: 'market_report',
          entityId: row.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'product_report.status_changed',
          before: { status: row.status },
          after: { status: next, action: body.action },
        });
        const table = TARGET_TABLE[row.target_type];
        if (body.action === 'remove_listing' && table) {
          // SOFT. No route restores a removed post.
          const [removed] = await tx.$queryRawUnsafe<{ id: string }[]>(
            `UPDATE public.${table} SET deleted_at = now(), deleted_by = $2::uuid
              WHERE id = $1::uuid AND deleted_at IS NULL RETURNING id`,
            row.target_id,
            auth.principal.id,
          );
          if (removed) {
            await writeAudit(tx, {
              entityType: table,
              entityId: row.target_id,
              actorType: auth.role,
              actorId: auth.principal.id,
              action: 'product_report.listing_removed',
              before: { deleted_at: null },
              after: { deleted_at: 'now', report_id: row.id },
            });
          }
        }
      });
      return ok(present(await load(row.id)));
    },
  },
});
