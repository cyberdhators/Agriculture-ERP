import { decodeCursor, encodeCursor, publicGuideFilterSchema } from '@agri-erp/shared';

import { invalidCursor } from '../../../lib/api/errors';
import {
  PUBLIC_GUIDE_COLUMNS,
  PUBLIC_GUIDE_FROM,
  PUBLIC_GUIDE_WHERE,
  presentGuide,
  type PublicGuideRow,
} from '../../../lib/api/learning';
import { likePattern, pageLimit, parseQuery } from '../../../lib/api/market-posts';
import { defineRoutes, paged } from '../../../lib/api/route';
import { prisma } from '../../../lib/db';

/**
 * GET /api/guides -- Advice & Learning's published guides, for anyone
 * (2026-10-22; CORWADO's specification: "Public visitors can browse published
 * listings and advice.").
 *
 * PUBLIC AND READ-ONLY. Only `status = 'published'` rows of the _active view,
 * so a draft, a guide in review, an unpublished or a removed one is never
 * listed. Each row leaves through presentGuide, a whitelist: the English and
 * Arabic title and summary, topics, crop, language, format, size and the
 * publish date. Never the storage path, a staff id or name, or a review note.
 *
 * Filters, all optional and validated by the shared publicGuideFilterSchema:
 * topic (one of ADVICE_TOPICS), language (en | ar, the language of the file),
 * q (title or summary, either language). Newest publication first.
 *
 * Nothing written, so nothing audited. No request limiter exists anywhere in
 * this system (apps/web/tests/public-route-scan.test.ts says so); a read of
 * public text is the least exposed of the public routes.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async ({ request }) => {
      const filter = parseQuery(request, publicGuideFilterSchema);
      const limit = pageLimit(filter.limit);
      const params: unknown[] = [];
      const add = (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
      };
      const where = [PUBLIC_GUIDE_WHERE];
      if (filter.topic) where.push(`${add(filter.topic)} = ANY(topics)`);
      if (filter.language) where.push(`language::text = ${add(filter.language)}`);
      if (filter.q) {
        const p = add(likePattern(filter.q));
        where.push(
          `(title ILIKE ${p} ESCAPE '\\' OR title_ar ILIKE ${p} ESCAPE '\\'
            OR description ILIKE ${p} ESCAPE '\\' OR description_ar ILIKE ${p} ESCAPE '\\')`,
        );
      }
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        where.push(
          `(COALESCE(published_at, uploaded_at), id) < (${add(cursor.createdAt)}::timestamptz, ${add(cursor.id)}::uuid)`,
        );
      }
      const rows = await prisma.$queryRawUnsafe<PublicGuideRow[]>(
        `SELECT ${PUBLIC_GUIDE_COLUMNS} ${PUBLIC_GUIDE_FROM}
          WHERE ${where.join(' AND ')}
          ORDER BY COALESCE(published_at, uploaded_at) DESC, id DESC
          LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(page.map(presentGuide), {
        cursor:
          hasMore && last
            ? encodeCursor({ createdAt: last.published_on.toISOString(), id: last.id })
            : null,
        hasMore,
      });
    },
  },
});
