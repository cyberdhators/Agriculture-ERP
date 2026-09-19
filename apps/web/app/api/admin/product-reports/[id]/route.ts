import { moderateReportSchema, toIso, type ModerationAction } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { ApiFailure, notFound } from '../../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/**
 * One product report, and the decisions an administrator may take on it.
 * ADMINISTRATOR ONLY.
 *
 * THE REPORTER IS NEVER RETURNED. `submission_digest` is not selected by any
 * query in this file. The description IS returned here — unlike in the list —
 * because investigating one report is the moment an administrator needs it,
 * and it reaches one screen opened deliberately rather than forty rows at once.
 */

/**
 * The transitions the server allows. The state machine is HERE, not in the
 * screen: a status is the record of a decision, and a client cannot be the
 * thing that decides which decisions are possible.
 *
 * `resolved` and `dismissed` are terminal. A report that has been settled is
 * not reopened through this route — if that is ever wanted it is a new
 * decision with its own audit action, not a loosened rule.
 */
const TRANSITIONS: Record<string, readonly string[]> = {
  new: ['reviewing', 'resolved', 'dismissed'],
  reviewing: ['resolved', 'dismissed'],
  resolved: [],
  dismissed: [],
};

const ACTION_STATUS: Record<ModerationAction, string | null> = {
  mark_reviewing: 'reviewing',
  resolve: 'resolved',
  dismiss: 'dismissed',
  // Removing the listing is an act on the LISTING; the report's own status is
  // settled by the same call, because a moderator who removes a listing has
  // plainly finished with the report.
  remove_listing: 'resolved',
  suspend_listing: 'reviewing',
};

interface ReportRow {
  id: string;
  listing_id: string;
  reason: string;
  description: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
  listing_title: string | null;
  vendor_name: string | null;
  listing_status: string | null;
}

/** The shape of an id, checked before the database is asked (lib/api/farmers.ts). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT = `SELECT r.id, r.listing_id, r.reason::text AS reason, r.description,
        r.status::text AS status, r.created_at, r.updated_at, r.resolved_at,
        l.title AS listing_title, l.trading_name AS vendor_name, l.status::text AS listing_status
   FROM public.product_report_active r
   LEFT JOIN public.produce_listing_active l ON l.id = r.listing_id
  WHERE r.id = $1::uuid`;

/** A malformed id is a missing report, not a database error. */
const loadReport = async (id: string): Promise<ReportRow> => {
  if (!UUID.test(id)) throw notFound();
  const [row] = await prisma.$queryRawUnsafe<ReportRow[]>(SELECT, id);
  if (!row) throw notFound();
  return row;
};

const present = (row: ReportRow) => ({
  id: row.id,
  listing_id: row.listing_id,
  ...(row.listing_title === null ? {} : { listing_title: row.listing_title }),
  ...(row.vendor_name === null ? {} : { vendor_name: row.vendor_name }),
  ...(row.listing_status === null ? {} : { listing_status: row.listing_status }),
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
    handler: async ({ params }) => {
      const row = await loadReport(params.id ?? '');
      return ok(present(row));
    },
  },

  PATCH: {
    roles: ['admin'],
    bodySchema: moderateReportSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const row = await loadReport(params.id ?? '');

      const next = ACTION_STATUS[body.action as ModerationAction];
      if (!next) throw notFound();
      if (!TRANSITIONS[row.status]?.includes(next)) {
        throw new ApiFailure(
          422,
          'transition_not_allowed',
          'That decision is not available for this report in its current state.',
        );
      }

      const settled = next === 'resolved' || next === 'dismissed';
      const removesListing = body.action === 'remove_listing';

      const updated = await audited(prisma, async (tx) => {
        const [changed] = await tx.$queryRawUnsafe<ReportRow[]>(
          `WITH r AS (
             UPDATE public.product_report
                SET status = $2::public.report_status,
                    resolved_by = CASE WHEN $3 THEN $4::uuid ELSE resolved_by END,
                    resolved_at = CASE WHEN $3 THEN now() ELSE resolved_at END,
                    updated_at = now()
              WHERE id = $1::uuid AND deleted_at IS NULL
              RETURNING *
           )
           SELECT r.id, r.listing_id, r.reason::text AS reason, r.description,
                  r.status::text AS status, r.created_at, r.updated_at, r.resolved_at,
                  l.title AS listing_title, l.trading_name AS vendor_name,
                  l.status::text AS listing_status
             FROM r LEFT JOIN public.produce_listing_active l ON l.id = r.listing_id`,
          row.id,
          next,
          settled,
          auth.principal.id,
        );
        if (!changed) throw notFound();

        await writeAudit(tx, {
          entityType: 'product_report',
          entityId: row.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'product_report.status_changed',
          before: { status: row.status },
          // The action and the status, never the description: that is free
          // text a member of the public wrote and may name a person (C-4.7).
          after: { status: next, action: body.action },
        });

        if (removesListing) {
          // SOFT. The deletion law admits no exception, and no route restores
          // a listing — so nothing here should suggest one does.
          const [removed] = await tx.$queryRawUnsafe<{ id: string }[]>(
            `UPDATE public.produce_listing SET deleted_at = now(), deleted_by = $2::uuid
              WHERE id = $1::uuid AND deleted_at IS NULL RETURNING id`,
            row.listing_id,
            auth.principal.id,
          );
          if (removed) {
            await writeAudit(tx, {
              entityType: 'produce_listing',
              entityId: row.listing_id,
              actorType: auth.role,
              actorId: auth.principal.id,
              action: 'product_report.listing_removed',
              before: { deleted_at: null },
              after: { deleted_at: 'now' },
            });
          }
        }

        return changed;
      });

      return ok(present(updated));
    },
  },
});
