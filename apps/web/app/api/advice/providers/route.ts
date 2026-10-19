import { adviceProviderFilterSchema, decodeCursor } from '@agri-erp/shared';

import {
  PROVIDER_COLUMNS,
  PROVIDER_PUBLIC_WHERE,
  presentProvider,
  type ProviderRow,
} from '../../../../lib/api/advice';
import { invalidCursor } from '../../../../lib/api/errors';
import { cursorOf, likePattern, pageLimit, parseQuery } from '../../../../lib/api/market-posts';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/advice/providers -- the public directory of advice providers
 * (2026-10-22). docs/DECISIONS.md, "Advice: find a provider and ask".
 *
 * Every published profile whose account is live (not deleted, not
 * suspended), newest change first, with search (q) and filters: topic,
 * language, state (a profile covering no named state covers anywhere, so it
 * matches every state) and delivery mode. The person chooses; nothing here
 * ranks or recommends.
 *
 * Rows leave through presentProvider -- no phone, no account id. Public,
 * read-only, writes nothing.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async ({ request }) => {
      const filter = parseQuery(request, adviceProviderFilterSchema);
      const limit = pageLimit(filter.limit);
      const params: unknown[] = [];
      const add = (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
      };
      const where = [PROVIDER_PUBLIC_WHERE];
      if (filter.q) {
        const p = add(likePattern(filter.q));
        where.push(
          `(p.display_name ILIKE ${p} ESCAPE '\\' OR p.description ILIKE ${p} ESCAPE '\\'
            OR coalesce(p.availability, '') ILIKE ${p} ESCAPE '\\')`,
        );
      }
      if (filter.topic) where.push(`${add(filter.topic)} = ANY (p.topics)`);
      if (filter.language) where.push(`${add(filter.language)} = ANY (p.languages)`);
      if (filter.state_id) {
        where.push(`(cardinality(p.state_ids) = 0 OR ${add(filter.state_id)} = ANY (p.state_ids))`);
      }
      if (filter.delivery_mode) where.push(`${add(filter.delivery_mode)} = ANY (p.delivery_modes)`);
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        where.push(
          `(p.updated_at, p.id) < (${add(cursor.createdAt)}::timestamptz, ${add(cursor.id)}::uuid)`,
        );
      }
      const rows = await prisma.$queryRawUnsafe<ProviderRow[]>(
        `SELECT ${PROVIDER_COLUMNS} FROM public.advice_provider p
          WHERE ${where.join(' AND ')}
          ORDER BY p.updated_at DESC, p.id DESC
          LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(page.map(presentProvider), {
        cursor: hasMore && last ? cursorOf(last) : null,
        hasMore,
      });
    },
  },
});
