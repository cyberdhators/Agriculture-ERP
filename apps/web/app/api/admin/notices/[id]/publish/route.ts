import { compareNoticeVersions } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../../lib/api/errors';
import { checkId } from '../../../../../../lib/api/market-posts';
import { requirePermission } from '../../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { NOTICE_SELECT, presentNotice, type NoticeRow } from '../../../../../../lib/api/settings';
import { prisma } from '../../../../../../lib/db';

/**
 * POST /api/admin/notices/:id/publish (2026-10-25, settings phase 1).
 * ADMINISTRATOR ONLY, then `settings.manage`. No body.
 *
 * In ONE transaction: the notice published now of the same kind and language
 * is RETIRED (kept, never deleted -- people agreed to it), and this draft is
 * PUBLISHED. Two audit rows: notice.retired and notice.published, each with
 * kind, language and version, never the body. The partial unique index allows
 * one published notice per kind and language, so a concurrent publish fails
 * rather than leaving two.
 *
 * From the next page load, the sign-up screens show the new consent text and
 * record its version ('<version>-<language>') with every new consent.
 * Consents already given keep the version they recorded; nobody is asked to
 * agree again by this route.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin'],
    handler: async ({ auth, params }) => {
      await requirePermission(auth, 'settings.manage');
      const id = checkId(params.id);

      const row = await audited(prisma, async (tx) => {
        const [draft] = await tx.$queryRawUnsafe<NoticeRow[]>(
          `${NOTICE_SELECT} WHERE n.id = $1::uuid AND n.deleted_at IS NULL FOR UPDATE`,
          id,
        );
        if (!draft) throw notFound();
        if (draft.status !== 'draft') throw unprocessable('notice_not_draft');

        const [published] = await tx.$queryRawUnsafe<NoticeRow[]>(
          `${NOTICE_SELECT}
            WHERE n.kind = $1 AND n.language = $2::public.language
              AND n.status = 'published' AND n.deleted_at IS NULL
            FOR UPDATE`,
          draft.kind,
          draft.language,
        );
        if (published && compareNoticeVersions(draft.version, published.version) <= 0) {
          throw unprocessable('notice_version_not_newer');
        }

        if (published) {
          await tx.$executeRawUnsafe(
            `UPDATE public.notice
                SET status = 'retired', retired_at = now(), retired_by = $2::uuid,
                    updated_at = now()
              WHERE id = $1::uuid`,
            published.id,
            auth.principal.id,
          );
          await writeAudit(tx, {
            entityType: 'notice',
            entityId: published.id,
            actorType: auth.role,
            actorId: auth.principal.id,
            action: 'notice.retired',
            before: { status: 'published' },
            after: {
              status: 'retired',
              kind: published.kind,
              language: published.language,
              version: published.version,
              replaced_by: id,
            },
          });
        }

        await tx.$executeRawUnsafe(
          `UPDATE public.notice
              SET status = 'published', published_at = now(), published_by = $2::uuid,
                  updated_at = now()
            WHERE id = $1::uuid`,
          id,
          auth.principal.id,
        );
        await writeAudit(tx, {
          entityType: 'notice',
          entityId: id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'notice.published',
          before: { status: 'draft' },
          after: {
            status: 'published',
            kind: draft.kind,
            language: draft.language,
            version: draft.version,
            ...(published ? { replaces: published.id } : {}),
          },
        });

        const [fresh] = await tx.$queryRawUnsafe<NoticeRow[]>(
          `${NOTICE_SELECT} WHERE n.id = $1::uuid`,
          id,
        );
        return fresh;
      });

      if (!row) throw notFound(); // unreachable: just written
      return ok(presentNotice(row));
    },
  },
});
