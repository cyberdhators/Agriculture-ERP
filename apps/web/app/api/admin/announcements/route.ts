import {
  ANNOUNCEMENT_LIMITS,
  announcementDraftSchema,
  type AnnouncementDraftInput,
} from '@agri-erp/shared';

import {
  ANNOUNCEMENT_SELECT,
  checkDraftReferences,
  presentAnnouncement,
  type AnnouncementRow,
} from '../../../../lib/api/announcements';
import { audited, writeAudit } from '../../../../lib/api/audit';
import { requirePermission } from '../../../../lib/api/permissions';
import { created, defineRoutes, ok } from '../../../../lib/api/route';
import { requireWriter } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * /api/admin/announcements (2026-10-27). ADMINISTRATOR ONLY, then
 * `communications.send`. Enforced here, not by the screen.
 *
 * GET  -- the latest 50 announcements, drafts included, newest first.
 * POST { title, body, sms_body?, category, channels, scope, template_id? }
 *      -- a new DRAFT. Nothing is sent until it is previewed and sent
 *      (POST /api/admin/announcements/:id/send).
 *
 * The audit row carries the scope, channels and category -- never the text.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ auth }) => {
      await requirePermission(auth, 'communications.send');
      const rows = await prisma.$queryRawUnsafe<AnnouncementRow[]>(
        `${ANNOUNCEMENT_SELECT}
          WHERE a.deleted_at IS NULL
          ORDER BY a.created_at DESC, a.id
          LIMIT ${ANNOUNCEMENT_LIMITS.listMax}`,
      );
      return ok(rows.map(presentAnnouncement));
    },
  },

  POST: {
    roles: ['admin'],
    bodySchema: announcementDraftSchema,
    handler: async ({ auth, body: raw }) => {
      requireWriter(auth);
      await requirePermission(auth, 'communications.send');
      const body = raw as AnnouncementDraftInput;
      const row = await audited(prisma, async (tx) => {
        await checkDraftReferences(tx, body);
        const [fresh] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.announcement
             (title, body, sms_body, category, channels, scope_kind, scope_state_id,
              scope_activity, template_id, created_by)
           VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9::uuid, $10::uuid)
           RETURNING id`,
          body.title,
          body.body,
          body.channels.includes('sms') ? body.sms_body : null,
          body.category,
          body.channels,
          body.scope.kind,
          body.scope.state_id,
          body.scope.activity,
          body.template_id,
          auth.principal.id,
        );
        if (!fresh) throw new Error('announcement insert returned no row');
        await writeAudit(tx, {
          entityType: 'announcement',
          entityId: fresh.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'announcement.drafted',
          after: {
            category: body.category,
            channels: body.channels,
            scope: body.scope,
            from_template: body.template_id !== null,
          },
        });
        const [full] = await tx.$queryRawUnsafe<AnnouncementRow[]>(
          `${ANNOUNCEMENT_SELECT} WHERE a.id = $1::uuid`,
          fresh.id,
        );
        return full as AnnouncementRow;
      });
      return created(presentAnnouncement(row));
    },
  },
});
