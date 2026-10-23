import { compareNoticeVersions, noticeEditSchema, type NoticeEditInput } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { conflict, notFound, unprocessable } from '../../../../../lib/api/errors';
import { checkId } from '../../../../../lib/api/market-posts';
import { requirePermission } from '../../../../../lib/api/permissions';
import { defineRoutes, empty, ok } from '../../../../../lib/api/route';
import { NOTICE_SELECT, presentNotice, type NoticeRow } from '../../../../../lib/api/settings';
import { prisma } from '../../../../../lib/db';

/**
 * /api/admin/notices/:id (2026-10-25, settings phase 1). ADMINISTRATOR ONLY,
 * then `settings.manage`. A DRAFT only (notice_not_draft): a published or
 * retired notice is what people agreed to, and is never edited or removed.
 *
 * PATCH { version?, body? } -- edit the draft.
 * DELETE                    -- discard the draft, SOFTLY (deleted_at).
 *
 * The audit row names the changed fields and the version, never the body.
 */
const lockDraft = async (
  tx: { $queryRawUnsafe: <T>(sql: string, ...p: unknown[]) => Promise<T> },
  id: string,
) => {
  const [row] = await tx.$queryRawUnsafe<NoticeRow[]>(
    `${NOTICE_SELECT} WHERE n.id = $1::uuid AND n.deleted_at IS NULL FOR UPDATE`,
    id,
  );
  if (!row) throw notFound();
  if (row.status !== 'draft') throw unprocessable('notice_not_draft');
  return row;
};

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: ['admin'],
    bodySchema: noticeEditSchema,
    handler: async ({ auth, body: raw, params }) => {
      await requirePermission(auth, 'settings.manage');
      const body = raw as NoticeEditInput;
      const id = checkId(params.id);

      const row = await audited(prisma, async (tx) => {
        const current = await lockDraft(tx, id);
        const version = body.version ?? current.version;
        if (version !== current.version) {
          const others = await tx.$queryRawUnsafe<{ version: string; status: string }[]>(
            `SELECT version, status FROM public.notice
              WHERE kind = $1 AND language = $2::public.language
                AND deleted_at IS NULL AND id <> $3::uuid`,
            current.kind,
            current.language,
            id,
          );
          if (others.some((n) => compareNoticeVersions(n.version, version) === 0)) {
            throw conflict('notice_version_exists');
          }
          const published = others.find((n) => n.status === 'published');
          if (published && compareNoticeVersions(version, published.version) <= 0) {
            throw unprocessable('notice_version_not_newer');
          }
        }
        await tx.$executeRawUnsafe(
          `UPDATE public.notice SET version = $2, body = $3, updated_at = now()
            WHERE id = $1::uuid`,
          id,
          version,
          body.body ?? current.body,
        );
        const fields = [
          ...(version !== current.version ? ['version'] : []),
          ...(body.body !== undefined && body.body !== current.body ? ['body'] : []),
        ];
        await writeAudit(tx, {
          entityType: 'notice',
          entityId: id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'notice.draft_edited',
          before: { version: current.version },
          after: { version, fields },
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

  DELETE: {
    roles: ['admin'],
    handler: async ({ auth, params }) => {
      await requirePermission(auth, 'settings.manage');
      const id = checkId(params.id);
      await audited(prisma, async (tx) => {
        const current = await lockDraft(tx, id);
        await tx.$executeRawUnsafe(
          `UPDATE public.notice SET deleted_at = now(), updated_at = now() WHERE id = $1::uuid`,
          id,
        );
        await writeAudit(tx, {
          entityType: 'notice',
          entityId: id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'notice.draft_discarded',
          before: { status: 'draft', version: current.version },
          after: { deleted: true },
        });
      });
      return empty(204);
    },
  },
});
