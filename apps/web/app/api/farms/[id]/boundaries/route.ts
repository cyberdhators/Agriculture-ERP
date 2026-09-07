import { addBoundarySchema } from '@agri-erp/shared';
import { audited, writeAudit } from '../../../../../lib/api/audit';
import { forbidden } from '../../../../../lib/api/errors';
import { inCaseloadOf } from '../../../../../lib/api/farmers';
import { loadVisibleFarm, presentBoundary } from '../../../../../lib/api/farms';
import { boundaryHistory, insertBoundary } from '../../../../../lib/api/geometry';
import { created, defineRoutes, ok } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/farms/:id/boundaries — an officer with the farmer in their
 * caseload re-maps: the new boundary becomes current for its season and the
 * previous one is kept (C-7.5). GET — the history, scoped, geometry per C-7.8.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ auth, params }) => {
      const farm = await loadVisibleFarm(prisma, params.id ?? '', auth);
      const rows = await boundaryHistory(prisma, farm.id);
      return ok(rows.map((b) => presentBoundary(b, auth)));
    },
  },
  POST: {
    roles: ['officer'],
    bodySchema: addBoundarySchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const farm = await loadVisibleFarm(prisma, params.id ?? '', auth);
      if (!inCaseloadOf(auth, farm)) throw forbidden();
      const { row, superseded } = await audited(prisma, async (tx) => {
        const result = await insertBoundary(tx, {
          farmId: farm.id,
          season: body.season,
          polygon: body.boundary,
          gpsAccuracyM: body.gps_accuracy_m,
          mappedBy: auth.principal.id,
        });
        await writeAudit(tx, {
          entityType: 'farm',
          entityId: farm.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: result.superseded ? 'farm.boundary_superseded' : 'farm.boundary_added',
          before: result.superseded ? { boundary_id: result.superseded } : null,
          after: {
            boundary_id: result.row.id,
            season: result.row.season,
            area_ha: Number(result.row.area_ha),
            point_count: result.row.point_count,
            grade: result.row.accuracy_flag,
          },
        });
        return result;
      });
      return created({ ...presentBoundary(row, auth), superseded: superseded });
    },
  },
});
