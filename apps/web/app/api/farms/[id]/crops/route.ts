import { declareCropsSchema } from '@agri-erp/shared';
import { audited, writeAudit } from '../../../../../lib/api/audit';
import { forbidden } from '../../../../../lib/api/errors';
import { inCaseloadOf } from '../../../../../lib/api/farmers';
import { type CropRow, loadVisibleFarm } from '../../../../../lib/api/farms';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/** PUT /api/farms/:id/crops — replaces the season's declarations (C-7.7). Officer, caseload only. */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PUT: {
    roles: ['officer'],
    bodySchema: declareCropsSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const farm = await loadVisibleFarm(prisma, params.id ?? '', auth);
      if (!inCaseloadOf(auth, farm)) throw forbidden();
      const rows = await audited(prisma, async (tx) => {
        const before = await tx.$queryRawUnsafe<{ crop: string }[]>(
          `DELETE FROM public.crop_declaration WHERE farm_id = $1::uuid AND season = $2 RETURNING crop::text AS crop`,
          farm.id,
          body.season,
        );
        for (const crop of body.crops) {
          await tx.$executeRawUnsafe(
            `INSERT INTO public.crop_declaration (farm_id, season, crop, declared_by)
             VALUES ($1::uuid, $2, $3::public.crop, $4::uuid)`,
            farm.id,
            body.season,
            crop,
            auth.principal.id,
          );
        }
        await writeAudit(tx, {
          entityType: 'farm',
          entityId: farm.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'farm.crops_declared',
          before: { season: body.season, crops: before.map((b) => b.crop).sort() },
          after: { season: body.season, crops: [...body.crops].sort() },
        });
        return tx.$queryRawUnsafe<CropRow[]>(
          `SELECT farm_id, season, crop::text AS crop FROM public.crop_declaration WHERE farm_id = $1::uuid ORDER BY season DESC, crop`,
          farm.id,
        );
      });
      return ok(rows.map((c) => ({ season: c.season, crop: c.crop })));
    },
  },
});
