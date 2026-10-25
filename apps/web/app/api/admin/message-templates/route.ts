import { templateCreateSchema, type TemplateCreateInput } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import {
  TEMPLATE_SELECT,
  presentTemplate,
  type TemplateRow,
} from '../../../../lib/api/message-templates';
import { requirePermission } from '../../../../lib/api/permissions';
import { created, defineRoutes, ok } from '../../../../lib/api/route';
import { requireWriter } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * /api/admin/message-templates (2026-10-27). ADMINISTRATOR ONLY, then
 * `communications.send` (every administrator; other staff through the
 * Administrator preset). Enforced here, not by the screen.
 *
 * GET  -- every template: active first, then drafts, then archived.
 * POST { name, channel, title?, body } -- a new DRAFT template.
 *
 * A template is never deleted: an announcement may name it. It is archived
 * and can be restored (PATCH /api/admin/message-templates/:id).
 *
 * The audit row carries the channel and status -- never the text.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth }) => {
      await requirePermission(auth, 'communications.send');
      const rows = await prisma.$queryRawUnsafe<TemplateRow[]>(
        `${TEMPLATE_SELECT}
          ORDER BY CASE t.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
                   t.updated_at DESC, t.id`,
      );
      return ok(rows.map(presentTemplate));
    },
  },

  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: templateCreateSchema,
    handler: async ({ auth, body: raw }) => {
      requireWriter(auth);
      await requirePermission(auth, 'communications.send');
      const body = raw as TemplateCreateInput;
      const row = await audited(prisma, async (tx) => {
        const [fresh] = await tx.$queryRawUnsafe<TemplateRow[]>(
          `WITH t AS (
             INSERT INTO public.message_template (name, channel, title, body, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5::uuid, $5::uuid)
             RETURNING *
           )
           ${TEMPLATE_SELECT.replace('FROM public.message_template t', 'FROM t')}`,
          body.name,
          body.channel,
          body.channel === 'sms' ? null : (body.title ?? null),
          body.body,
          auth.principal.id,
        );
        if (!fresh) throw new Error('template insert returned no row');
        await writeAudit(tx, {
          entityType: 'message_template',
          entityId: fresh.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'message_template.created',
          after: { channel: fresh.channel, status: fresh.status },
        });
        return fresh;
      });
      return created(presentTemplate(row));
    },
  },
});
