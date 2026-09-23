import { ALL_ROLES, DEFAULT_LIMIT, MAX_LIMIT, decodeCursor, encodeCursor } from '@agri-erp/shared';

import { invalidCursor } from '../../../lib/api/errors';
import { defineRoutes, paged } from '../../../lib/api/route';
import { scopeCondition } from '../../../lib/api/scope';
import { prisma } from '../../../lib/db';

/**
 * GET /api/contact-requests
 *
 * Staff lists buyer contact requests for their scope. An admin sees all; a
 * supervisor or read_only sees their state; an officer sees their caseload's
 * farmers' requests. Newest first, cursor-paginated.
 */

interface ContactRow {
  id: string;
  listing_id: string;
  farmer_id: string;
  buyer_name: string;
  buyer_phone: string;
  message: string | null;
  quantity: string | null;
  status: string;
  note: string | null;
  created_at: string;
  handled_at: string | null;
  handled_by: string | null;
  listing_title: string;
  farmer_name: string;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ALL_ROLES,
    handler: async (ctx) => {
      const auth = ctx.auth!;
      const url = new URL(ctx.request.url);
      const limit = Math.min(
        Math.max(1, Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT)),
        MAX_LIMIT,
      );
      const after = url.searchParams.get('after');

      let cursorSql = '';
      const cursorParams: unknown[] = [];
      if (after) {
        const decoded = decodeCursor(after);
        if (!decoded) throw invalidCursor();
        cursorSql = ` AND (cr.created_at, cr.id) < ($P_CUR_TS::timestamptz, $P_CUR_ID::uuid)`;
        cursorParams.push(decoded.createdAt, decoded.id);
      }

      // Scope: for officer, scope through the farmer's caseload_officer_id.
      // For state/admin, scope through the farmer's state_id.
      const sc = scopeCondition(auth.scope, 'f.state_id', 'f.caseload_officer_id', 100);
      const scopeSql = sc.sql ? ` AND ${sc.sql}` : '';

      // Build params array with proper $N numbering
      let paramIdx = 1;
      const params: unknown[] = [];

      // Replace cursor placeholders
      let finalCursorSql = cursorSql;
      if (cursorParams.length > 0) {
        finalCursorSql = finalCursorSql
          .replace('$P_CUR_TS', `$${paramIdx}`)
          .replace('$P_CUR_ID', `$${paramIdx + 1}`);
        params.push(...cursorParams);
        paramIdx += cursorParams.length;
      }

      // Replace scope placeholders
      let finalScopeSql = scopeSql;
      if (sc.params.length > 0) {
        finalScopeSql = finalScopeSql.replace(`$100`, `$${paramIdx}`);
        params.push(...sc.params);
        paramIdx += sc.params.length;
      }

      // Limit
      const limitParam = `$${paramIdx}`;
      params.push(limit + 1);

      const rows = await prisma.$queryRawUnsafe<ContactRow[]>(
        `SELECT cr.id, cr.listing_id, cr.farmer_id,
                cr.buyer_name, cr.buyer_phone, cr.message, cr.quantity,
                cr.status::text AS status, cr.note,
                cr.created_at::text AS created_at,
                cr.handled_at::text AS handled_at,
                cr.handled_by,
                pl.title AS listing_title,
                (f.given_name || ' ' || f.family_name) AS farmer_name
         FROM public.contact_request cr
         JOIN public.farmer f ON f.id = cr.farmer_id
         JOIN public.produce_listing pl ON pl.id = cr.listing_id
         WHERE f.deleted_at IS NULL${finalCursorSql}${finalScopeSql}
         ORDER BY cr.created_at DESC, cr.id DESC
         LIMIT ${limitParam}`,
        ...params,
      );

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];

      return paged(page, {
        cursor: last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
        hasMore,
      });
    },
  },
});
