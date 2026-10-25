import { decodeCursor } from '@agri-erp/shared';

import { invalidCursor } from '../../../../lib/api/errors';
import { cursorOf, likePattern, pageLimit } from '../../../../lib/api/market-posts';
import { PERSON_NAME_SQL } from '../../../../lib/api/organizations';
import { requirePermission } from '../../../../lib/api/permissions';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/admin/organizations -- staff find an organisational profile and
 * see its team (2026-10-27), for evidence-based exceptional recovery and for
 * support. `support.handle`. Search by name (`q`); newest first.
 *
 * Staff see who is on the team and in which role -- names as "Mary K.", the
 * membership's status, when it ended and why -- never the shared inbox:
 * private conversations are not a staff resource.
 */
interface Row {
  id: string;
  name: string;
  profile_kind: string;
  status: string;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  members: {
    id: string;
    name: string;
    preset: string;
    status: string;
    ended_at: string | null;
    end_reason: string | null;
  }[];
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth, request }) => {
      await requirePermission(auth, 'support.handle');
      const search = new URL(request.url).searchParams;
      const limit = pageLimit(search.get('limit') ?? undefined);
      const params: unknown[] = [];
      const add = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      const where = ['o.deleted_at IS NULL'];
      const q = search.get('q')?.trim();
      if (q) where.push(`o.name ILIKE ${add(likePattern(q.slice(0, 120)))} ESCAPE '\\'`);
      const cursor = search.get('cursor');
      if (cursor) {
        const c = decodeCursor(cursor);
        if (!c) throw invalidCursor();
        where.push(`(o.updated_at, o.id) < (${add(c.createdAt)}::timestamptz, ${add(c.id)}::uuid)`);
      }
      const rows = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT o.id, o.name, o.profile_kind, o.status, o.closed_at, o.created_at, o.updated_at,
                COALESCE((
                  SELECT json_agg(json_build_object(
                           'id', m.id, 'name', ${PERSON_NAME_SQL('m.auth_user_id')},
                           'preset', m.preset, 'status', m.status,
                           'ended_at', m.ended_at, 'end_reason', m.end_reason)
                         ORDER BY (m.status = 'active') DESC, m.joined_at)
                    FROM public.organization_member m WHERE m.organization_id = o.id
                ), '[]'::json) AS members
           FROM public.organization o
          WHERE ${where.join(' AND ')}
          ORDER BY o.updated_at DESC, o.id DESC
          LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(
        page.map((r) => ({
          id: r.id,
          name: r.name,
          profile_kind: r.profile_kind,
          status: r.status,
          closed: r.closed_at !== null,
          created_at: r.created_at.toISOString(),
          members: r.members,
          administrators: r.members.filter(
            (m) => m.status === 'active' && m.preset === 'administrator',
          ).length,
        })),
        { cursor: hasMore && last ? cursorOf(last) : null, hasMore },
      );
    },
  },
});
