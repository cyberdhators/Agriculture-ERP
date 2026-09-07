import { recordVisitSchema } from '@agri-erp/shared';
import { audited, writeAudit } from '../../../../../lib/api/audit';
import { conflict, forbidden } from '../../../../../lib/api/errors';
import { loadVisible } from '../../../../../lib/api/farmers';
import { created, defineRoutes } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import {
  insertVisit,
  pageVisits,
  parseVisitFilter,
  presentVisit,
  visitAuditFields,
} from '../../../../../lib/api/visits';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/farmers/:id/visits — an officer with the farmer in their caseload
 * records a visit (C-8.1, C-8.9). Any non-removed farmer, whatever their
 * verification status: a visit to a pending farmer is a real visit, and the
 * officer cannot know the supervisor's decision (owner, 2026-09-07).
 * GET — the farmer's visits, scoped, newest received first.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ auth, params, request }) => {
      const farmer = await loadVisible(prisma, params.id ?? '', auth);
      return pageVisits(prisma, auth, parseVisitFilter(request), { farmerId: farmer.id });
    },
  },
  POST: {
    roles: ['officer'],
    bodySchema: recordVisitSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      // Caseload scope: a farmer outside it is a 404 (C-8.9).
      const farmer = await loadVisible(prisma, params.id ?? '', auth);
      if (auth.scope.kind !== 'caseload' || farmer.registered_by !== auth.principal.id) {
        throw forbidden();
      }
      const [existing] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        'SELECT id FROM public.visit WHERE id = $1::uuid',
        body.id,
      );
      if (existing) throw conflict('visit_already_exists');

      const row = await audited(prisma, async (tx) => {
        const visit = await insertVisit(tx, { body, farmer, officerId: auth.principal.id });
        await writeAudit(tx, {
          entityType: 'visit',
          entityId: visit.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'visit.recorded',
          // Never the substance, never the point (C-8.13).
          after: visitAuditFields(visit),
        });
        return visit;
      });
      return created(presentVisit(row, [], auth));
    },
  },
});
