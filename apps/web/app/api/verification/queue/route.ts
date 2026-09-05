import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  daysWaiting,
  decodeCursor,
  encodeCursor,
  isEscalated,
  queueFilterSchema,
  toIso,
  zodErrorToApiError,
} from '@agri-erp/shared';
import { ApiFailure, invalidCursor } from '../../../../lib/api/errors';
import {
  FARMER_COLUMNS,
  FARMER_FROM,
  type FarmerRow,
  present,
  scopeClause,
} from '../../../../lib/api/farmers';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/verification/queue (C-6.7): pending farmers in the caller's scope,
 * oldest clock first, days waiting and escalation computed, each farmer's
 * duplicate matches expanded beside it — only those matches the caller may
 * see, since a phone match can cross a state line.
 *
 * Sort: pending_since ascending, then id, so the cursor is (pending_since, id)
 * carried in the standard cursor's timestamp slot.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ request, auth }) => {
      const url = new URL(request.url);
      const parsed = queueFilterSchema.safeParse(Object.fromEntries(url.searchParams));
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
      const where = [`f.verification_status = 'pending'`, ...scopeClause(auth, params)];
      const add = (sql: (i: number) => string, value: unknown) => {
        params.push(value);
        where.push(sql(params.length));
      };
      if (filter.payam) add((i) => `f.payam_id = $${i}`, filter.payam);
      if (filter.county) add((i) => `f.county_id = $${i}`, filter.county);
      if (filter.escalated === 'true') where.push(`now() - f.pending_since > interval '7 days'`);
      if (filter.escalated === 'false') where.push(`now() - f.pending_since <= interval '7 days'`);
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(f.pending_since, f.id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<FarmerRow[]>(
        `SELECT ${FARMER_COLUMNS} ${FARMER_FROM}
         WHERE ${where.join(' AND ')}
         ORDER BY f.pending_since ASC, f.id ASC
         LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);

      // Expand duplicate matches, scoped: the reviewer sees both records.
      const matchIds = [...new Set(page.flatMap((r) => r.duplicate_matches))];
      let matches: FarmerRow[] = [];
      if (matchIds.length > 0) {
        const mp: unknown[] = [matchIds];
        const mwhere = ['f.id = ANY($1::uuid[])', ...scopeClause(auth, mp)];
        matches = await prisma.$queryRawUnsafe<FarmerRow[]>(
          `SELECT ${FARMER_COLUMNS} ${FARMER_FROM} WHERE ${mwhere.join(' AND ')}`,
          ...mp,
        );
      }
      const byId = new Map(matches.map((m) => [m.id, m]));

      const last = page[page.length - 1];
      return paged(
        page.map((row) => {
          const days = daysWaiting(row.pending_since);
          return {
            ...present(row, auth),
            days_waiting: days,
            escalated: isEscalated(days),
            duplicates: row.duplicate_matches
              .map((id) => byId.get(id))
              .filter((m): m is FarmerRow => m !== undefined)
              .map((m) => present(m, auth)),
          };
        }),
        {
          cursor:
            hasMore && last
              ? encodeCursor({ createdAt: toIso(last.pending_since), id: last.id })
              : null,
          hasMore,
        },
      );
    },
  },
});
