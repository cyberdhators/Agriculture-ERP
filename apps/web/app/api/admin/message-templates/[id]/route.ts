import { smsEstimate, templateEditSchema, type TemplateEditInput } from '@agri-erp/shared';

import { idParam } from '../../../../../lib/api/announcements';
import { audited, writeAudit } from '../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../lib/api/errors';
import {
  TEMPLATE_SELECT,
  presentTemplate,
  type TemplateRow,
} from '../../../../../lib/api/message-templates';
import { requirePermission } from '../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/**
 * PATCH /api/admin/message-templates/:id (2026-10-27). ADMINISTRATOR ONLY,
 * then `communications.send`.
 *
 * { name?, title?, body?, status? } -- edit the text, or move the template
 * between draft, active and archived. The channel never changes. An archived
 * template stays (an announcement may name it) and can be restored.
 *
 * The audit row names the changed FIELDS and the status, never the text.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: ['admin', 'supervisor'],
    bodySchema: templateEditSchema,
    handler: async ({ auth, body: raw, params }) => {
      requireWriter(auth);
      await requirePermission(auth, 'communications.send');
      const body = raw as TemplateEditInput;
      const id = idParam(params);

      const row = await audited(prisma, async (tx) => {
        const [before] = await tx.$queryRawUnsafe<TemplateRow[]>(
          `${TEMPLATE_SELECT} WHERE t.id = $1::uuid FOR UPDATE OF t`,
          id,
        );
        if (!before) throw notFound();

        const title = body.title === undefined ? before.title : body.title;
        if ((before.channel === 'sms') !== (title === null || title === '')) {
          throw unprocessable('template_title_mismatch');
        }
        const text = body.body ?? before.body;
        if (before.channel === 'sms' && smsEstimate(text, 'x'.repeat(80)).segments > 3) {
          throw unprocessable('template_sms_too_long');
        }
        const next = {
          name: body.name ?? before.name,
          title: before.channel === 'sms' ? null : title,
          body: text,
          status: body.status ?? before.status,
        };
        const fields = (['name', 'title', 'body', 'status'] as const).filter(
          (k) => next[k] !== before[k],
        );
        if (fields.length === 0) return before;

        const [fresh] = await tx.$queryRawUnsafe<TemplateRow[]>(
          `WITH t AS (
             UPDATE public.message_template
                SET name = $2, title = $3, body = $4, status = $5,
                    updated_by = $6::uuid, updated_at = now()
              WHERE id = $1::uuid
             RETURNING *
           )
           ${TEMPLATE_SELECT.replace('FROM public.message_template t', 'FROM t')}`,
          id,
          next.name,
          next.title,
          next.body,
          next.status,
          auth.principal.id,
        );
        if (!fresh) throw notFound();
        const statusChanged = next.status !== before.status;
        await writeAudit(tx, {
          entityType: 'message_template',
          entityId: id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: statusChanged ? 'message_template.status_changed' : 'message_template.updated',
          before: { status: before.status },
          after: { status: fresh.status, channel: fresh.channel, fields },
        });
        return fresh;
      });
      return ok(presentTemplate(row));
    },
  },
});
