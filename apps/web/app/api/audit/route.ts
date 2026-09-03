import {
  DEFAULT_LIMIT,
  ERROR_CODES,
  ERROR_MESSAGES,
  MAX_LIMIT,
  auditFilterSchema,
  decodeCursor,
  encodeCursor,
  toIso,
  zodErrorToApiError,
} from '@agri-erp/shared';

import { ApiFailure, invalidCursor } from '../../../lib/api/errors';
import { defineRoutes, paged } from '../../../lib/api/route';
import { prisma } from '../../../lib/db';

interface AuditRow {
  id: string;
  entity_type: string;
  entity_id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  before: unknown;
  after: unknown;
  device_id: string | null;
  occurred_at: Date;
}

const present = (row: AuditRow) => ({
  id: row.id,
  entity_type: row.entity_type,
  entity_id: row.entity_id,
  actor_type: row.actor_type,
  actor_id: row.actor_id,
  action: row.action,
  before: row.before,
  after: row.after,
  device_id: row.device_id,
  occurred_at: toIso(row.occurred_at),
});

/**
 * The audit log. Administrators only (C-4.8): a supervisor reading who changed
 * what across the whole system is the kind of visibility C-3.4 exists to deny.
 *
 * Filters by record, by actor, and by date range (C-4.9). Cursor paginated on
 * (occurred_at, id) descending, per CONVENTIONS section 6.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ request }) => {
      const url = new URL(request.url);
      const raw = Object.fromEntries(url.searchParams.entries());
      const parsed = auditFilterSchema.safeParse(raw);
      if (!parsed.success) {
        const { body } = zodErrorToApiError(parsed.error);
        throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
      }
      const f = parsed.data;

      let limit = DEFAULT_LIMIT;
      if (f.limit !== undefined) {
        const n = Number(f.limit);
        if (!Number.isInteger(n) || n < 1) {
          throw new ApiFailure(400, ERROR_CODES.invalidInput, ERROR_MESSAGES.invalidInput, {
            limit: 'The page size must be at least 1.',
          });
        }
        limit = Math.min(n, MAX_LIMIT);
      }

      const where: string[] = [];
      const params: unknown[] = [];
      const add = (sql: string, value: unknown) => {
        params.push(value);
        where.push(sql.replace('?', `$${params.length}`));
      };
      if (f.entity_type) add('entity_type = ?', f.entity_type);
      if (f.entity_id) add('entity_id = ?', f.entity_id);
      if (f.actor_id) add('actor_id = ?::uuid', f.actor_id);
      if (f.from) add('occurred_at >= ?::timestamptz', f.from);
      if (f.to) add('occurred_at <= ?::timestamptz', f.to);
      if (f.cursor !== undefined) {
        const cursor = decodeCursor(f.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(occurred_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<AuditRow[]>(
        `SELECT id, entity_type, entity_id, actor_type::text AS actor_type, actor_id, action,
                before, after, device_id, occurred_at
         FROM public.audit_event
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY occurred_at DESC, id DESC
         LIMIT ${limit + 1}`,
        ...params,
      );

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(page.map(present), {
        cursor:
          hasMore && last
            ? encodeCursor({ createdAt: toIso(last.occurred_at), id: last.id })
            : null,
        hasMore,
      });
    },
  },
});
