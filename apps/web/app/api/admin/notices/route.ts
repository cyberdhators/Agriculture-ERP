import { compareNoticeVersions, noticeDraftSchema, type NoticeDraftInput } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { conflict, unprocessable } from '../../../../lib/api/errors';
import { requirePermission } from '../../../../lib/api/permissions';
import { created, defineRoutes, ok } from '../../../../lib/api/route';
import { NOTICE_SELECT, presentNotice, type NoticeRow } from '../../../../lib/api/settings';
import { prisma } from '../../../../lib/db';

/**
 * /api/admin/notices (2026-10-25, settings phase 1): versioned consent, terms
 * and privacy texts. ADMINISTRATOR ONLY, then `settings.manage`.
 *
 * GET  -- every notice that is not a discarded draft: drafts first, then
 *         published, then retired; newest version first within each.
 * POST { kind, language, version, body } -- a new DRAFT. Nobody sees it until
 *         it is published (POST /api/admin/notices/:id/publish).
 *
 * A version is never reused for the same kind and language
 * (notice_version_exists, and the unique index behind it), and a draft must
 * be numbered after the version already published (notice_version_not_newer),
 * so the version a farmer's consent records always names one text.
 *
 * The audit row carries kind, language and version -- never the body.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth }) => {
      await requirePermission(auth, 'settings.manage');
      const rows = await prisma.$queryRawUnsafe<NoticeRow[]>(
        `${NOTICE_SELECT}
          WHERE n.deleted_at IS NULL
          ORDER BY CASE n.status WHEN 'draft' THEN 0 WHEN 'published' THEN 1 ELSE 2 END,
                   n.kind, n.language, n.created_at DESC, n.id`,
      );
      return ok(rows.map(presentNotice));
    },
  },

  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: noticeDraftSchema,
    handler: async ({ auth, body: raw }) => {
      await requirePermission(auth, 'settings.manage');
      const body = raw as NoticeDraftInput;

      const row = await audited(prisma, async (tx) => {
        const existing = await tx.$queryRawUnsafe<{ version: string; status: string }[]>(
          `SELECT version, status FROM public.notice
            WHERE kind = $1 AND language = $2::public.language AND deleted_at IS NULL`,
          body.kind,
          body.language,
        );
        if (existing.some((n) => compareNoticeVersions(n.version, body.version) === 0)) {
          throw conflict('notice_version_exists');
        }
        const published = existing.find((n) => n.status === 'published');
        if (published && compareNoticeVersions(body.version, published.version) <= 0) {
          throw unprocessable('notice_version_not_newer');
        }

        const [fresh] = await tx.$queryRawUnsafe<NoticeRow[]>(
          `WITH n AS (
             INSERT INTO public.notice (kind, version, language, body, created_by)
             VALUES ($1, $2, $3::public.language, $4, $5::uuid)
             RETURNING *
           )
           ${NOTICE_SELECT.replace('FROM public.notice n', 'FROM n')}`,
          body.kind,
          body.version,
          body.language,
          body.body,
          auth.principal.id,
        );
        if (!fresh) throw new Error('notice insert returned no row');
        await writeAudit(tx, {
          entityType: 'notice',
          entityId: fresh.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'notice.drafted',
          after: { kind: body.kind, language: body.language, version: body.version },
        });
        return fresh;
      });

      return created(presentNotice(row));
    },
  },
});
