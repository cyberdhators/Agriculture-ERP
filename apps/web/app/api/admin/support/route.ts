import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  OPEN_SUPPORT_STATUSES,
  caseNumberQuery,
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
  CASE_ACCOUNT_JOIN,
  SUPPORT_ASSIGNEE_JOIN,
  SUPPORT_COLUMNS,
  presentSupport,
  type SupportRow,
} from '../../../../lib/api/support';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/admin/support -- support CASES, newest first (2026-10-21 as
 * "Contact CORWADO" messages; cases since 2026-10-28). ADMINISTRATOR ONLY,
 * and then `support.handle`, which every administrator holds
 * (lib/api/permissions.ts).
 *
 * Filters: status (a case status, or `open` = new + in progress + waiting;
 * the earlier 'done' is found under resolved), topic (`appeal` is the
 * Appeals view), case_type (a NULL type matches the type its topic implies),
 * priority, assignee (`me`, `none` or a staff id), q (a case number "#1045",
 * or part of the sender's name).
 *
 * The phone, email and text ARE returned: answering the person is the whole
 * point of the list, and it reaches staff who hold the support permission
 * only. `source_digest` and the sender's sign-in id are never selected. Each
 * case carries `account` -- the farmer or buyer record of a signed-in sender,
 * or the account an appeal is about when that can be told.
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
      const push = (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
      };
      if (filter.status === 'open') {
        where.push(`sm.status = ANY (${push([...OPEN_SUPPORT_STATUSES])}::text[])`);
      } else if (filter.status === 'resolved') {
        where.push(`sm.status IN ('resolved', 'done')`);
      } else if (filter.status) {
        where.push(`sm.status = ${push(filter.status)}`);
      }
      if (filter.topic) where.push(`sm.topic = ${push(filter.topic)}`);
      if (filter.case_type) {
        where.push(
          `COALESCE(sm.case_type, CASE sm.topic WHEN 'appeal' THEN 'appeal'
             WHEN 'technical' THEN 'technical' ELSE 'enquiry' END) = ${push(filter.case_type)}`,
        );
      }
      if (filter.priority) where.push(`sm.priority = ${push(filter.priority)}`);
      if (filter.assignee === 'none') where.push('sm.assignee_id IS NULL');
      else if (filter.assignee === 'me') {
        where.push(`sm.assignee_id = ${push(auth.principal.id)}::uuid`);
      } else if (filter.assignee) where.push(`sm.assignee_id = ${push(filter.assignee)}::uuid`);
      if (filter.q) {
        const number = caseNumberQuery(filter.q);
        if (number !== null) where.push(`sm.case_number = ${push(number)}::bigint`);
        else {
          const escaped = filter.q.replace(/[\\%_]/g, (c) => `\\${c}`);
          where.push(`sm.name ILIKE ${push(`%${escaped}%`)}`);
        }
      }
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        const at = push(cursor.createdAt);
        const id = push(cursor.id);
        where.push(`(sm.created_at, sm.id) < (${at}::timestamptz, ${id}::uuid)`);
      }

      const rows = await prisma.$queryRawUnsafe<SupportRow[]>(
        `SELECT ${SUPPORT_COLUMNS}, ${APPEAL_ACCOUNT_COLUMNS}
           FROM public.support_message sm
           ${SUPPORT_ASSIGNEE_JOIN}
           ${CASE_ACCOUNT_JOIN}
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
