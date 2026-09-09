import { toIso } from '@agri-erp/shared';
import { forbidden } from '../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/sync/caseload — the identifiers currently in the officer's caseload
 * (C-9.9): every non-removed farmer whose caseload pointer names them, the
 * farms of those farmers, and the visits to them. A record the device holds
 * that is absent here has left the caseload — reassigned, merged away or
 * removed — and the device removes it and everything under it, keeping
 * nothing: the officer has no right to that data any more. Identifiers only;
 * the lists with `updated_since` carry the records.
 *
 * Officers only. A supervisor or administrator has no caseload to sync.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['officer'],
    handler: async ({ auth }) => {
      if (auth.scope.kind !== 'caseload') throw forbidden();
      const officerId = auth.scope.officerId;
      const [farmers, farms, visits, [clock]] = await Promise.all([
        prisma.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM public.farmer_active WHERE caseload_officer_id = $1::uuid ORDER BY id`,
          officerId,
        ),
        prisma.$queryRawUnsafe<{ id: string }[]>(
          `SELECT f.id FROM public.farm_active f JOIN public.farmer_active fr ON fr.id = f.farmer_id
           WHERE fr.caseload_officer_id = $1::uuid ORDER BY f.id`,
          officerId,
        ),
        prisma.$queryRawUnsafe<{ id: string }[]>(
          `SELECT v.id FROM public.visit_active v JOIN public.farmer_active fr ON fr.id = v.farmer_id
           WHERE fr.caseload_officer_id = $1::uuid ORDER BY v.id`,
          officerId,
        ),
        prisma.$queryRawUnsafe<{ now: Date }[]>(`SELECT now() AS now`),
      ]);
      return ok({
        // The server's clock, for the device's next updated_since: never the phone's (C-8.5, C-9.9).
        as_of: toIso(clock!.now),
        farmers: farmers.map((r) => r.id),
        farms: farms.map((r) => r.id),
        visits: visits.map((r) => r.id),
      });
    },
  },
});
