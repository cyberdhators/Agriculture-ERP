import { BUYER_ROLE, emptyBodySchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { UUID_PATTERN, buyerActor } from '../../../../../lib/api/buyers';
import { notFound } from '../../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { buyerScope } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/**
 * PATCH /api/buyer/notifications/:id -- mark one notice read. B13, C-14B.20.
 *
 * The organisation is in the WHERE clause, so another organisation's notice is
 * 404. Marking an already-read notice read again changes nothing and writes no
 * second audit row.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: [BUYER_ROLE],
    bodySchema: emptyBodySchema,
    handler: async ({ auth, params }) => {
      const scope = buyerScope(auth);
      const id = params.id ?? '';
      if (!UUID_PATTERN.test(id)) throw notFound();
      const row = await audited(prisma, async (tx) => {
        const [current] = await tx.$queryRawUnsafe<{ id: string; read_at: Date | null }[]>(
          `SELECT id, read_at FROM public.notification
            WHERE id = $1::uuid AND buyer_organization_id = $2::uuid AND deleted_at IS NULL
            FOR UPDATE`,
          id,
          scope.organizationId,
        );
        if (!current) throw notFound();
        if (current.read_at) return current;
        const [updated] = await tx.$queryRawUnsafe<{ id: string; read_at: Date }[]>(
          `UPDATE public.notification SET read_at = now() WHERE id = $1::uuid RETURNING id, read_at`,
          id,
        );
        await writeAudit(tx, {
          entityType: 'notification',
          entityId: id,
          ...buyerActor(auth),
          action: 'notification.read',
        });
        return updated!;
      });
      return ok({ id: row.id, read_at: row.read_at?.toISOString() ?? null });
    },
  },
});
