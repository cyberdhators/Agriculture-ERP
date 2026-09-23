import { audited, writeAudit } from '../../../../lib/api/audit';
import { notFound } from '../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { scopeCondition } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

interface NotificationRow {
  id: string;
  farmer_id: string;
  channel: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

const present = (row: NotificationRow) => ({
  id: row.id,
  farmer_id: row.farmer_id,
  channel: row.channel,
  title: row.title,
  body: row.body,
  read_at: row.read_at,
  created_at: row.created_at,
});

const SELECT_COLUMNS = `n.id, n.farmer_id::text AS farmer_id,
  n.channel::text AS channel, n.title, n.body,
  n.read_at::text AS read_at, n.created_at::text AS created_at`;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ auth, params }) => {
      const id = params.id ?? '';

      const scopeWhere: string[] = ['n.deleted_at IS NULL'];
      const scopeParams: unknown[] = [id];
      scopeWhere.push(`n.id = $1::uuid`);

      const scope = scopeCondition(
        auth.scope,
        'f.state_id',
        'f.caseload_officer_id',
        scopeParams.length + 1,
      );
      if (scope.sql) {
        scopeWhere.push(scope.sql);
        scopeParams.push(...scope.params);
      }

      const existingRows = await prisma.$queryRawUnsafe<NotificationRow[]>(
        `SELECT ${SELECT_COLUMNS}
         FROM public.notification n
         JOIN public.farmer f ON f.id = n.farmer_id
         WHERE ${scopeWhere.join(' AND ')}`,
        ...scopeParams,
      );
      const existing = existingRows[0];
      if (!existing) throw notFound();

      if (existing.read_at) {
        return ok(present(existing));
      }

      const row = await audited(prisma, async (tx) => {
        const updatedRows = await tx.$queryRawUnsafe<NotificationRow[]>(
          `UPDATE public.notification
           SET read_at = now()
           WHERE id = $1::uuid AND read_at IS NULL
           RETURNING id, farmer_id::text AS farmer_id,
             channel::text AS channel, title, body,
             read_at::text AS read_at, created_at::text AS created_at`,
          id,
        );
        const updated = updatedRows[0]!;
        await writeAudit(tx, {
          entityType: 'notification',
          entityId: id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'notification.read',
          before: { read_at: null },
          after: { read_at: updated.read_at },
        });
        return updated;
      });

      return ok(present(row));
    },
  },
});
