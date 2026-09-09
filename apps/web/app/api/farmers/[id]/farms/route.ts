import { createFarmSchema } from '@agri-erp/shared';
import { audited, writeAudit } from '../../../../../lib/api/audit';
import { conflict, forbidden } from '../../../../../lib/api/errors';
import { inCaseloadOf, loadVisible, sameInstant } from '../../../../../lib/api/farmers';
import {
  FARM_COLUMNS,
  FARM_FROM,
  type FarmRow,
  cropsOf,
  farmScopeClause,
  loadVisibleFarm,
  presentFarm,
} from '../../../../../lib/api/farms';
import {
  boundaryMatches,
  currentBoundaries,
  insertBoundary,
} from '../../../../../lib/api/geometry';
import { created, defineRoutes, ok } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/farmers/:id/farms — an officer with the farmer in their caseload
 * creates a farm by mapping it: the first boundary comes with it (C-7.1,
 * C-7.6). GET — the farmer's farms, scoped, geometry per C-7.8.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ auth, params }) => {
      const farmer = await loadVisible(prisma, params.id ?? '', auth);
      const p: unknown[] = [farmer.id];
      const where = ['f.farmer_id = $1::uuid', ...farmScopeClause(auth, p)];
      const farms = await prisma.$queryRawUnsafe<FarmRow[]>(
        `SELECT ${FARM_COLUMNS} ${FARM_FROM} WHERE ${where.join(' AND ')} ORDER BY f.created_at DESC, f.id DESC`,
        ...p,
      );
      const ids = farms.map((f) => f.id);
      const [bounds, crops] = await Promise.all([
        currentBoundaries(prisma, ids),
        cropsOf(prisma, ids),
      ]);
      return ok(farms.map((f) => presentFarm(f, bounds, crops, auth)));
    },
  },
  POST: {
    roles: ['officer'],
    bodySchema: createFarmSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      // Caseload scope: a farmer outside it is a 404 (C-7.6).
      const farmer = await loadVisible(prisma, params.id ?? '', auth);
      if (!inCaseloadOf(auth, farmer)) {
        throw forbidden();
      }
      // C-9.2: a retry of a mapping that landed is 200 with the farm; the same
      // id wearing a different season, capture moment or boundary is a conflict.
      const [existing] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        'SELECT id FROM public.farm WHERE id = $1::uuid',
        body.id,
      );
      if (existing) {
        const stored = await loadVisibleFarm(prisma, body.id, auth).catch(() => null);
        if (
          stored &&
          stored.farmer_id === farmer.id &&
          stored.season === body.season &&
          sameInstant(body.captured_at, stored.captured_at) &&
          (await boundaryMatches(prisma, body.boundary_id, {
            farmId: stored.id,
            season: body.season,
            polygon: body.boundary,
            gpsAccuracyM: body.gps_accuracy_m,
          }))
        ) {
          const [bounds, crops] = await Promise.all([
            currentBoundaries(prisma, [stored.id]),
            cropsOf(prisma, [stored.id]),
          ]);
          return ok(presentFarm(stored, bounds, crops, auth));
        }
        throw conflict('farm_already_exists');
      }
      const [boundaryTaken] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        'SELECT id FROM public.farm_boundary WHERE id = $1::uuid',
        body.boundary_id,
      );
      if (boundaryTaken) throw conflict('boundary_already_exists');

      const result = await audited(prisma, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO public.farm (id, farmer_id, payam_id, county_id, state_id, season, created_by, captured_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid, $8::timestamptz)`,
          body.id,
          farmer.id,
          farmer.payam_id,
          farmer.county_id,
          farmer.state_id,
          body.season,
          auth.principal.id,
          body.captured_at ?? null,
        );
        const { row } = await insertBoundary(tx, {
          id: body.boundary_id,
          farmId: body.id,
          season: body.season,
          polygon: body.boundary,
          gpsAccuracyM: body.gps_accuracy_m,
          mappedBy: auth.principal.id,
        });
        const actor = { actorType: auth.role, actorId: auth.principal.id } as const;
        await writeAudit(tx, {
          entityType: 'farm',
          entityId: body.id,
          ...actor,
          action: 'farm.created',
          after: {
            farmer_id: farmer.id,
            payam_id: farmer.payam_id,
            county_id: farmer.county_id,
            state_id: farmer.state_id,
            season: body.season,
          },
        });
        await writeAudit(tx, {
          entityType: 'farm',
          entityId: body.id,
          ...actor,
          action: 'farm.boundary_added',
          after: {
            boundary_id: row.id,
            season: row.season,
            area_ha: Number(row.area_ha),
            point_count: row.point_count,
            grade: row.accuracy_flag,
          },
        });
        const [farm] = await tx.$queryRawUnsafe<FarmRow[]>(
          `SELECT ${FARM_COLUMNS} ${FARM_FROM} WHERE f.id = $1::uuid`,
          body.id,
        );
        return { farm: farm as FarmRow, boundary: row };
      });
      return created(presentFarm(result.farm, [result.boundary], [], auth));
    },
  },
});
