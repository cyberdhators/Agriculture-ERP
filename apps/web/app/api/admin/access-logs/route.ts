import {
  DEFAULT_LIMIT,
  ERROR_CODES,
  ERROR_MESSAGES,
  MAX_LIMIT,
  USER_ROLES,
  accessLogFilterSchema,
  decodeCursor,
  encodeCursor,
  toIso,
  zodErrorToApiError,
} from '@agri-erp/shared';

import { ApiFailure, invalidCursor } from '../../../../lib/api/errors';
import { requirePermission } from '../../../../lib/api/permissions';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

interface AccessRow {
  id: string;
  principal_kind: string;
  principal_id: string;
  actor_name: string | null;
  event: string;
  occurred_at: Date;
  device_label: string | null;
  last_seen_at: Date | null;
}

/** `%` and `_` typed into a name search are characters, not wildcards. */
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * GET /api/admin/access-logs -- the access log, searched by account, event and
 * date range. 2026-10-19, staff permissions lane.
 *
 * Roles: admin, supervisor, read_only (requireRole). Permission: `audit.view`
 * PLATFORM-WIDE: the log spans every state and every kind of account, so a
 * state-scoped grant does not reach it.
 *
 * Names are shown, and searched, for staff and officers only. A farmer or a
 * buyer appears by kind and id, never by name (C-4.7's reasoning). Times are
 * UTC on the wire; the screen shows them in Africa/Juba. Cursor paginated on
 * (occurred_at, id) descending, as the audit trail is.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: USER_ROLES,
    handler: async ({ auth, request }) => {
      await requirePermission(auth, 'audit.view');

      const raw = Object.fromEntries(new URL(request.url).searchParams.entries());
      const parsed = accessLogFilterSchema.safeParse(raw);
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
        where.push(sql.replaceAll('?', `$${params.length}`));
      };
      if (f.actor_kind) add('l.principal_kind = ?', f.actor_kind);
      if (f.actor_id) add('l.principal_id = ?::uuid', f.actor_id);
      if (f.event) add('l.event = ?', f.event);
      if (f.from) add('l.occurred_at >= ?::timestamptz', f.from);
      if (f.to) add('l.occurred_at <= ?::timestamptz', f.to);
      if (f.name) add(`(u.name ILIKE ? OR o.name ILIKE ?)`, `%${likeEscape(f.name)}%`);
      if (f.cursor !== undefined) {
        const cursor = decodeCursor(f.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(l.occurred_at, l.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<AccessRow[]>(
        `SELECT l.id, l.principal_kind, l.principal_id, l.event, l.occurred_at, l.device_label,
                CASE l.principal_kind WHEN 'user' THEN u.name WHEN 'officer' THEN o.name END
                  AS actor_name,
                a.last_seen_at
           FROM public.access_log l
           LEFT JOIN public."user" u ON l.principal_kind = 'user' AND u.id = l.principal_id
           LEFT JOIN public.officer o ON l.principal_kind = 'officer' AND o.id = l.principal_id
           LEFT JOIN public.account_activity a
                  ON a.principal_kind = l.principal_kind AND a.principal_id = l.principal_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY l.occurred_at DESC, l.id DESC
          LIMIT ${limit + 1}`,
        ...params,
      );

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(
        page.map((r) => ({
          id: r.id,
          actor_kind: r.principal_kind,
          actor_id: r.principal_id,
          actor_name: r.actor_name,
          event: r.event,
          occurred_at: toIso(r.occurred_at),
          device_label: r.device_label,
          last_activity_at: r.last_seen_at ? toIso(r.last_seen_at) : null,
        })),
        {
          cursor:
            hasMore && last
              ? encodeCursor({ createdAt: toIso(last.occurred_at), id: last.id })
              : null,
          hasMore,
        },
      );
    },
  },
});
