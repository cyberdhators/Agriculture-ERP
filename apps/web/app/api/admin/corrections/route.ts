import {
  correctionListQuerySchema,
  correctionRequestSchema,
  decodeCursor,
  encodeCursor,
  toIso,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { conflict, invalidCursor } from '../../../../lib/api/errors';
import {
  CORRECTION_SELECT,
  TARGET_COLUMN,
  checkListingReasonCode,
  loadCorrectionTarget,
  presentCorrection,
  reasonCodesSetting,
  type CorrectionRow,
} from '../../../../lib/api/listing-corrections';
import { pageLimit, parseQuery } from '../../../../lib/api/market-posts';
import { notifyAccount } from '../../../../lib/api/notify';
import { requirePermission } from '../../../../lib/api/permissions';
import { created, defineRoutes, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET / POST /api/admin/corrections -- a moderator asks the owner of a
 * produce listing, service listing or buying request to correct it
 * (2026-10-27, CORWADO's specification: "Inspect, request correction and
 * moderate with a reason; listing removal is separate from account action").
 * ADMINISTRATOR ONLY, and then `content.moderate`, as every moderation route.
 *
 * POST names the post, an active reason code offered for listings, and a note
 * saying what to fix. In one transaction: the request (at most one open per
 * post -- a second is 409), its audit row (`listing.correction_requested`,
 * with the code and the note, as a suspension records its reason), and ONE
 * fixed in-app notice to the owner. THE POST IS NOT CHANGED: it stays on the
 * market unless a moderator separately removes it.
 *
 * GET lists requests, newest first, filtered by status (open / addressed),
 * post type or one post. "addressed" means the owner has edited the post
 * since (lib/api/listing-corrections.ts addressCorrections).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ auth, request }) => {
      await requirePermission(auth, 'content.moderate');
      const filter = parseQuery(request, correctionListQuerySchema);
      const limit = pageLimit(filter.limit);
      const params: unknown[] = [];
      const where: string[] = [];
      if (filter.status) {
        params.push(filter.status);
        where.push(`c.status = $${params.length}`);
      }
      if (filter.target_type) {
        params.push(filter.target_type);
        where.push(`c.target_type = $${params.length}`);
      }
      if (filter.target_id) {
        params.push(filter.target_id);
        where.push(
          `COALESCE(c.produce_listing_id, c.service_listing_id, c.buying_request_id) = $${params.length}::uuid`,
        );
      }
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(c.requested_at, c.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }
      const rows = await prisma.$queryRawUnsafe<CorrectionRow[]>(
        `${CORRECTION_SELECT}
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY c.requested_at DESC, c.id DESC
         LIMIT ${limit + 1}`,
        ...params,
      );
      const setting = await reasonCodesSetting(prisma);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(
        page.map((row) => presentCorrection(row, setting)),
        {
          cursor:
            hasMore && last
              ? encodeCursor({ createdAt: toIso(last.requested_at), id: last.id })
              : null,
          hasMore,
        },
      );
    },
  },

  POST: {
    roles: ['admin'],
    bodySchema: correctionRequestSchema,
    handler: async ({ auth, body }) => {
      await requirePermission(auth, 'content.moderate');
      const setting = await reasonCodesSetting(prisma);
      checkListingReasonCode(setting, body.reason_code);
      const actor = { actorType: auth.role, actorId: auth.principal.id } as const;

      const row = await audited(prisma, async (tx) => {
        const target = await loadCorrectionTarget(tx, body.target_type, body.target_id);
        const [open] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM public.listing_correction
            WHERE ${TARGET_COLUMN[body.target_type]} = $1::uuid
              AND status = 'open' AND deleted_at IS NULL
            FOR UPDATE`,
          body.target_id,
        );
        if (open) throw conflict('correction_already_open');

        const [inserted] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.listing_correction
             (target_type, ${TARGET_COLUMN[body.target_type]}, reason_code, note, requested_by)
           VALUES ($1, $2::uuid, $3, $4, $5::uuid)
           RETURNING id`,
          body.target_type,
          body.target_id,
          body.reason_code,
          body.note,
          auth.principal.id,
        );
        await writeAudit(tx, {
          entityType: 'listing_correction',
          entityId: inserted!.id,
          ...actor,
          action: 'listing.correction_requested',
          after: {
            status: 'open',
            target_type: body.target_type,
            target_id: body.target_id,
            reason_code: body.reason_code,
            reason: body.note,
          },
        });
        // The owner is told by a FIXED sentence; the note is on their own post.
        const notified = await notifyAccount(
          tx,
          { authUserId: target.owner_auth_user_id, farmerId: target.owner_farmer_id },
          'listing_correction_requested',
          actor,
        );
        const [saved] = await tx.$queryRawUnsafe<CorrectionRow[]>(
          `${CORRECTION_SELECT} WHERE c.id = $1::uuid`,
          inserted!.id,
        );
        return { saved: saved!, notified };
      });
      return created({ ...presentCorrection(row.saved, setting), owner_notified: row.notified });
    },
  },
});
