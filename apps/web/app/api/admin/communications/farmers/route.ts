import {
  COMMUNICATION_LIMITS,
  communicationFarmerFilterSchema,
  decodeCursor,
  encodeCursor,
  toIso,
  zodErrorToApiError,
  type CommunicationFarmer,
  type CommunicationFarmerIds,
} from '@agri-erp/shared';

import { ApiFailure, invalidCursor } from '../../../../../lib/api/errors';
import { scopeClause } from '../../../../../lib/api/farmers';
import { defineRoutes, ok, paged } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/admin/communications/farmers — the farmer picker behind the SMS
 * composer. ADMINISTRATOR ONLY, like the send it feeds.
 *
 * WHY NOT GET /api/farmers. That route serves the register to four roles and
 * returns a farmer's phone number. The picker needs a free-text search, a
 * "select every match" mode, and NO phone number at all: the send carries ids
 * and the server resolves the numbers itself. A search may MATCH on a phone —
 * an administrator types the digits they were given — but nothing here ever
 * returns one.
 *
 * TWO SHAPES.
 *   - Without `select`: one page of rows, newest registration first, with the
 *     number of matches in `page.total` so the screen can say how many.
 *   - With `select=ids`: every REACHABLE matching id, up to the per-message
 *     cap, so "select all matching" is one request rather than the browser
 *     paging through the register. `capped` says when there were more.
 *
 * REACHABLE means an SMS could actually be sent: consent granted and not
 * withdrawn, and a South Sudan mobile number on file. The same rule the send
 * route applies, so a selection cannot promise more than the send delivers.
 * Soft-deleted farmers are absent, because this reads `farmer_active`.
 */

const REACHABLE = `(c.granted = true AND c.withdrawn_at IS NULL AND f.phone ~ '^\\+211[0-9]{9}$')`;

const PAGE_DEFAULT = 25;
const PAGE_MAX = 100;

/** `%` and `_` typed into the search are text, not wildcards. */
const likeEscape = (text: string) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ request, auth }) => {
      const url = new URL(request.url);
      const parsed = communicationFarmerFilterSchema.safeParse(
        Object.fromEntries(url.searchParams),
      );
      if (!parsed.success) {
        const { body } = zodErrorToApiError(parsed.error);
        throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
      }
      const filter = parsed.data;

      const params: unknown[] = [];
      const where: string[] = scopeClause(auth, params);
      const add = (sql: (i: number) => string, value: unknown) => {
        params.push(value);
        where.push(sql(params.length));
      };

      if (filter.state) add((i) => `f.state_id = $${i}`, filter.state);
      if (filter.county) add((i) => `f.county_id = $${i}`, filter.county);
      if (filter.payam) add((i) => `f.payam_id = $${i}`, filter.payam);
      if (filter.verification_status) {
        add(
          (i) => `f.verification_status = $${i}::public.verification_status`,
          filter.verification_status,
        );
      }
      if (filter.q) {
        const text = `%${likeEscape(filter.q)}%`;
        const digits = filter.q.replace(/\D/g, '');
        params.push(text);
        const t = params.length;
        const clauses = [
          `(f.given_name || ' ' || f.family_name) ILIKE $${t}`,
          `(f.family_name || ' ' || f.given_name) ILIKE $${t}`,
          `f.farmer_number ILIKE $${t}`,
        ];
        // Digits match a phone however they were typed: "0912 345", "+211912".
        // At least four, so a single digit does not match half the register.
        if (digits.length >= 4) {
          params.push(`%${digits}%`);
          clauses.push(`regexp_replace(f.phone, '[^0-9]', '', 'g') LIKE $${params.length}`);
        }
        where.push(`(${clauses.join(' OR ')})`);
      }

      const from = `FROM public.farmer_active f JOIN public.consent c ON c.id = f.consent_id`;
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      if (filter.select === 'ids') {
        const cap = COMMUNICATION_LIMITS.recipientsMax;
        const rows = await prisma.$queryRawUnsafe<{ id: string; total: bigint | number }[]>(
          `SELECT f.id, count(*) OVER () AS total ${from}
           ${whereSql ? `${whereSql} AND ${REACHABLE}` : `WHERE ${REACHABLE}`}
           ORDER BY f.created_at DESC, f.id DESC
           LIMIT ${cap}`,
          ...params,
        );
        const total = rows.length ? Number(rows[0]!.total) : 0;
        const answer: CommunicationFarmerIds = {
          ids: rows.map((r) => r.id),
          total,
          capped: total > cap,
        };
        return ok(answer);
      }

      let limit = PAGE_DEFAULT;
      if (filter.limit !== undefined) {
        const n = Number(filter.limit);
        if (!Number.isInteger(n) || n < 1) throw invalidCursor();
        limit = Math.min(n, PAGE_MAX);
      }

      // The count is of the filter, not of the page, and is taken before the
      // cursor narrows anything.
      const [counted] = await prisma.$queryRawUnsafe<
        { total: bigint | number; reachable: bigint | number }[]
      >(
        `SELECT count(*) AS total, count(*) FILTER (WHERE ${REACHABLE}) AS reachable
         ${from} ${whereSql}`,
        ...params,
      );

      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(f.created_at, f.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<
        {
          id: string;
          farmer_number: string;
          given_name: string;
          family_name: string;
          state_id: string;
          county_id: string;
          payam_id: string;
          verification_status: string;
          reachable: boolean;
          created_at: Date;
        }[]
      >(
        `SELECT f.id, f.farmer_number, f.given_name, f.family_name, f.state_id, f.county_id,
                f.payam_id, f.verification_status::text AS verification_status,
                ${REACHABLE} AS reachable, f.created_at
         ${from}
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY f.created_at DESC, f.id DESC
         LIMIT ${limit + 1}`,
        ...params,
      );

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const data: CommunicationFarmer[] = page.map((r) => ({
        id: r.id,
        farmer_number: r.farmer_number,
        name: `${r.given_name} ${r.family_name}`,
        state_id: r.state_id,
        county_id: r.county_id,
        payam_id: r.payam_id,
        verification_status: r.verification_status,
        reachable: r.reachable,
      }));
      return paged(data, {
        cursor:
          hasMore && last ? encodeCursor({ createdAt: toIso(last.created_at), id: last.id }) : null,
        hasMore,
        total: Number(counted?.total ?? 0),
        reachable: Number(counted?.reachable ?? 0),
      });
    },
  },
});
