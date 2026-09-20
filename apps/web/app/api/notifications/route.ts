import { DEFAULT_LIMIT, MAX_LIMIT, decodeCursor, encodeCursor } from '@agri-erp/shared';

import { invalidCursor } from '../../../lib/api/errors';
import { defineRoutes, paged } from '../../../lib/api/route';
import { scopeCondition } from '../../../lib/api/scope';
import { prisma } from '../../../lib/db';

interface NotificationRow {
  id: string;
  farmer_id: string;
  channel: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

const present = (row: NotificationRow) => ({
  id: row.id,
  farmer_id: row.farmer_id,
  channel: row.channel,
  title: row.title,
  body: row.body,
  read_at: row.read_at,
  created_at: row.created_at,
});

const SELECT_COLUMNS = `n.id, n.farmer_id::text AS farmer_id,
  n.channel::text AS channel, n.title, n.body,
  n.read_at::text AS read_at, n.created_at::text AS created_at`;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ request, auth }) => {
      const url = new URL(request.url);
      const rawLimit = url.searchParams.get('limit');
      const rawCursor = url.searchParams.get('cursor');

      let limit = DEFAULT_LIMIT;
      if (rawLimit !== null) {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1) throw invalidCursor();
        limit = Math.min(parsed, MAX_LIMIT);
      }

      const where: string[] = ['n.deleted_at IS NULL'];
      const params: unknown[] = [];

      const scope = scopeCondition(
        auth.scope,
        'f.state_id',
        'f.caseload_officer_id',
        params.length + 1,
      );
      if (scope.sql) {
        where.push(scope.sql);
        params.push(...scope.params);
      }

      const farmerId = url.searchParams.get('farmer_id');
      if (farmerId !== null) {
        params.push(farmerId);
        where.push(`n.farmer_id = $${params.length}::uuid`);
      }

      const unreadOnly = url.searchParams.get('unread') === '1';
      if (unreadOnly) {
        where.push('n.read_at IS NULL');
      }

      if (rawCursor !== null) {
        const cursor = decodeCursor(rawCursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(n.created_at, n.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<NotificationRow[]>(
        `SELECT ${SELECT_COLUMNS}
         FROM public.notification n
         JOIN public.farmer f ON f.id = n.farmer_id
         WHERE ${where.join(' AND ')}
         ORDER BY n.created_at DESC, n.id DESC
         LIMIT ${limit + 1}`,
        ...params,
      );

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];

      return paged(page.map(present), {
        cursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
        hasMore,
      });
    },
  },
});
