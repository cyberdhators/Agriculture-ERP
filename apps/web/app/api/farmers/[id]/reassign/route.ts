import { reassignFarmerSchema } from '@agri-erp/shared';
import { audited, writeAudit } from '../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../lib/api/errors';
import {
  FARMER_COLUMNS,
  FARMER_FROM,
  type FarmerRow,
  loadVisible,
  present,
} from '../../../../../lib/api/farmers';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/farmers/:id/reassign — an administrator moves a farmer's caseload
 * to another officer (C-8R.2). The new officer is active and in the farmer's
 * payam, registration's own rule: an officer who is not where the farmer is
 * cannot visit them. The same officer is refused as a no-op, so the log never
 * records a move that was not one. registered_by does not change (C-5.9).
 * Farms and visits follow the farmer without being touched (C-8R.4).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin'],
    bodySchema: reassignFarmerSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const farmer = await loadVisible(prisma, params.id ?? '', auth);
      if (farmer.caseload_officer_id === body.officer_id)
        throw unprocessable('reassign_same_officer');
      const [officer] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM public.officer
         WHERE id = $1::uuid AND status = 'active' AND deleted_at IS NULL AND payam_id = $2`,
        body.officer_id,
        farmer.payam_id,
      );
      if (!officer) throw unprocessable('reassign_officer_not_found');

      const row = await audited(prisma, async (tx) => {
        const [updated] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `UPDATE public.farmer SET caseload_officer_id = $2::uuid, updated_at = now()
           WHERE id = $1::uuid AND deleted_at IS NULL RETURNING id`,
          farmer.id,
          officer.id,
        );
        if (!updated) throw notFound();
        await writeAudit(tx, {
          entityType: 'farmer',
          entityId: farmer.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'farmer.reassigned',
          before: { caseload_officer_id: farmer.caseload_officer_id },
          after: { caseload_officer_id: officer.id },
        });
        const [fresh] = await tx.$queryRawUnsafe<FarmerRow[]>(
          `SELECT ${FARMER_COLUMNS} ${FARMER_FROM} WHERE f.id = $1::uuid`,
          farmer.id,
        );
        if (!fresh) throw notFound();
        return fresh;
      });
      return ok(present(row, auth));
    },
  },
});
