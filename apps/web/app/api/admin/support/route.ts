import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  decodeCursor,
  encodeCursor,
  supportFilterSchema,
  zodErrorToApiError,
} from '@agri-erp/shared';

import { ApiFailure, invalidCursor } from '../../../../lib/api/errors';
import { requirePermission } from '../../../../lib/api/permissions';
import { defineRoutes, paged } from '../../../../lib/api/route';
import {
  APPEAL_ACCOUNT_COLUMNS,
  APPEAL_ACCOUNT_JOIN,
  SUPPORT_COLUMNS,
  presentSupport,
  type SupportRow,
} from '../../../../lib/api/support';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/admin/support -- "Contact CORWADO" messages, newest first
 * (2026-10-21). ADMINISTRATOR ONLY, and then `support.handle`, which every
 * administrator holds (lib/api/permissions.ts).
 *
 * The phone, email and text ARE returned: answering the person is the whole
 * point of the list, and it reaches staff who hold the support permission
 * only. `source_digest` and the sender's sign-in id are never selected.
 *
 * 2026-10-26: `?topic=appeal` is the Appeals view, and an appeal carries
 * `account` -- the farmer or buyer record it is about, when that can be told
 * (lib/api/support.ts APPEAL_ACCOUNT_JOIN) -- so staff open the record and
 * Restore there. The sign-in id itself is still never returned.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ auth, request }) => {
      await requirePermission(auth, 'support.handle');

      const parsed = supportFilterSchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success) {
        const { body } = zodErrorToApiError(parsed.error);
        throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
      }
      const filter = parsed.data;

      let limit = DEFAULT_LIMIT;
      if (filter.limit !== undefined) {
        const n = Number(filter.limit);
        if (!Number.isInteger(n) || n < 1) throw invalidCursor();
        limit = Math.min(n, MAX_LIMIT);
      }

      const params: unknown[] = [];
      const where: string[] = ['sm.deleted_at IS NULL'];
      if (filter.status) {
        params.push(filter.status);
        where.push(`sm.status = $${params.length}`);
      }
      if (filter.topic) {
        params.push(filter.topic);
        where.push(`sm.topic = $${params.length}`);
      }
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(sm.created_at, sm.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<SupportRow[]>(
        `SELECT ${SUPPORT_COLUMNS}, ${APPEAL_ACCOUNT_COLUMNS}
           FROM public.support_message sm
           ${APPEAL_ACCOUNT_JOIN}
          WHERE ${where.join(' AND ')}
          ORDER BY sm.created_at DESC, sm.id DESC
          LIMIT ${limit + 1}`,
        ...params,
      );

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).map(presentSupport);
      const last = page[page.length - 1];
      return paged(page, {
        cursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
        hasMore,
      });
    },
  },
});
