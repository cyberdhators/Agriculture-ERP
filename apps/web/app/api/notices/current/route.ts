import {
  consentTextVersion,
  noticeCurrentQuerySchema,
  type CurrentNotice,
  type NoticeLanguage,
  type PolicyNoticeKind,
} from '@agri-erp/shared';

import { notFound } from '../../../../lib/api/errors';
import { parseQuery } from '../../../../lib/api/market-posts';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { settingsTablesPresent } from '../../../../lib/api/settings';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/notices/current?kind=consent&lang=en (2026-10-25, settings phase
 * 1). PUBLIC, READ-ONLY: a person signing up has no account yet, and must read
 * the text they agree to.
 *
 * The one PUBLISHED notice of that kind and language, through a whitelist:
 * kind, language, version, the text version a consent records
 * ('<version>-<language>'), the body and when it was published. Never a draft,
 * never a retired text, never who published it. 404 when none is published
 * (or the settings migration is not yet applied); the sign-up screens then
 * keep their built-in v1.3 text, exactly as before. Writes nothing.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async ({ request }) => {
      const { kind, lang } = parseQuery(request, noticeCurrentQuerySchema);
      if (!(await settingsTablesPresent())) throw notFound();
      const [row] = await prisma.$queryRawUnsafe<
        {
          kind: PolicyNoticeKind;
          language: NoticeLanguage;
          version: string;
          body: string;
          published_at: Date;
        }[]
      >(
        `SELECT kind, language::text AS language, version, body, published_at
           FROM public.notice
          WHERE kind = $1 AND language = $2::public.language
            AND status = 'published' AND deleted_at IS NULL`,
        kind,
        lang,
      );
      if (!row) throw notFound();
      const notice: CurrentNotice = {
        kind: row.kind,
        language: row.language,
        version: row.version,
        text_version: consentTextVersion(row.version, row.language),
        body: row.body,
        published_at: row.published_at.toISOString(),
      };
      return ok(notice, {
        'cache-control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
      });
    },
  },
});
