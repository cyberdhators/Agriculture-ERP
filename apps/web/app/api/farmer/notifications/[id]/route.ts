import { FARMER_ROLE, emptyBodySchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { UUID_PATTERN } from '../../../../../lib/api/buyer-presenters';
import { notFound } from '../../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { farmerScope } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/** PATCH /api/farmer/notifications/:id -- mark one of the farmer's notices read. B14. */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: [FARMER_ROLE],
    bodySchema: emptyBodySchema,
    handler: async ({ auth, params }) => {
      const { farmerId } = farmerScope(auth);
      const id = params.id ?? '';
      if (!UUID_PATTERN.test(id)) throw notFound();
      const readAt = await audited(prisma, async (tx) => {
        const [current] = await tx.$queryRawUnsafe<{ read_at: Date | null }[]>(
          `SELECT read_at FROM public.notification
            WHERE id = $1::uuid AND farmer_id = $2::uuid AND deleted_at IS NULL FOR UPDATE`,
          id,
          farmerId,
        );
        if (!current) throw notFound();
        if (current.read_at) return current.read_at;
        const [row] = await tx.$queryRawUnsafe<{ read_at: Date }[]>(
          'UPDATE public.notification SET read_at = now() WHERE id = $1::uuid RETURNING read_at',
          id,
        );
        await writeAudit(tx, {
          entityType: 'notification',
          entityId: id,
          actorType: 'farmer',
          actorId: farmerId,
          action: 'notification.read',
        });
        return row!.read_at;
      });
      return ok({ id, read_at: readAt.toISOString() });
    },
  },
});
