import { toIso } from '@agri-erp/shared';
import { audited, writeAudit } from '../../../../lib/api/audit';
import { notFound } from '../../../../lib/api/errors';
import { cropsOf, loadVisibleFarm, presentFarm } from '../../../../lib/api/farms';
import { currentBoundaries } from '../../../../lib/api/geometry';
import { defineRoutes, empty, ok } from '../../../../lib/api/route';
import { requireWriter } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/** GET /api/farms/:id — scoped, geometry per C-7.8. DELETE — administrator, soft (C-7.9). */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ auth, params }) => {
      const farm = await loadVisibleFarm(prisma, params.id ?? '', auth);
      const [bounds, crops] = await Promise.all([
        currentBoundaries(prisma, [farm.id]),
        cropsOf(prisma, [farm.id]),
      ]);
      return ok(presentFarm(farm, bounds, crops, auth));
    },
  },
  DELETE: {
    roles: ['admin'],
    handler: async ({ auth, params }) => {
      requireWriter(auth);
      const farm = await loadVisibleFarm(prisma, params.id ?? '', auth);
      await audited(prisma, async (tx) => {
        const [row] = await tx.$queryRawUnsafe<{ deleted_at: Date }[]>(
          `UPDATE public.farm SET deleted_at = now(), deleted_by = $2::uuid
           WHERE id = $1::uuid AND deleted_at IS NULL RETURNING deleted_at`,
          farm.id,
          auth.principal.id,
        );
        if (!row) throw notFound();
        await writeAudit(tx, {
          entityType: 'farm',
          entityId: farm.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'farm.soft_deleted',
          before: { deleted_at: null },
          after: { deleted_at: toIso(row.deleted_at) },
        });
      });
      return empty(204);
    },
  },
});
