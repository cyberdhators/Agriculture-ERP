import { supportDoneSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { notFound } from '../../../../../lib/api/errors';
import { requirePermission } from '../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { SUPPORT_COLUMNS, presentSupport, type SupportRow } from '../../../../../lib/api/support';
import { prisma } from '../../../../../lib/db';

/**
 * PATCH /api/admin/support/:id { status: 'done' } -- a staff member marks a
 * "Contact CORWADO" message done (2026-10-21). ADMINISTRATOR ONLY, and then
 * `support.handle`.
 *
 * Done is the only change and it is terminal: no reopen, no assignment, no
 * reply (helpdesk ticketing is out of scope). Marking a done message done
 * again changes nothing, writes no audit row, and answers with it as it is.
 */

/** The shape of an id, checked before the database is asked (lib/api/farmers.ts). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: ['admin'],
    bodySchema: supportDoneSchema,
    handler: async ({ auth, params }) => {
      await requirePermission(auth, 'support.handle');
      const id = params.id ?? '';
      if (!UUID.test(id)) throw notFound();

      const row = await audited(prisma, async (tx) => {
        const [changed] = await tx.$queryRawUnsafe<SupportRow[]>(
          `UPDATE public.support_message
              SET status = 'done', handled_by = $2::uuid, handled_at = now()
            WHERE id = $1::uuid AND deleted_at IS NULL AND status = 'new'
            RETURNING ${SUPPORT_COLUMNS}`,
          id,
          auth.principal.id,
        );
        if (changed) {
          await writeAudit(tx, {
            entityType: 'support_message',
            entityId: changed.id,
            actorType: auth.role,
            actorId: auth.principal.id,
            action: 'support_message.done',
            before: { status: 'new' },
            after: { status: 'done' },
          });
          return changed;
        }
        const [current] = await tx.$queryRawUnsafe<SupportRow[]>(
          `SELECT ${SUPPORT_COLUMNS} FROM public.support_message
            WHERE id = $1::uuid AND deleted_at IS NULL`,
          id,
        );
        if (!current) throw notFound();
        return current;
      });

      return ok(presentSupport(row));
    },
  },
});
