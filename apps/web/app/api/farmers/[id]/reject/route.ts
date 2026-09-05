import { rejectFarmerSchema } from '@agri-erp/shared';
import { audited } from '../../../../../lib/api/audit';
import { unprocessable } from '../../../../../lib/api/errors';
import { loadVisible, present } from '../../../../../lib/api/farmers';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import { type Decision, transitionFarmer } from '../../../../../lib/api/verification';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/farmers/:id/reject (C-6). Scope first: a farmer outside the
 * caller's scope is a 404 before any decision is considered. The state
 * machine in lib/api/verification.ts decides whether the record may take the
 * decision; this route only names it.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: rejectFarmerSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const source = await loadVisible(prisma, params.id ?? '', auth);
      const decision: Decision =
        body.reason_code === undefined
          ? (() => {
              throw unprocessable('reason_required');
            })()
          : {
              kind: 'reject',
              reasonCode: body.reason_code,
              ...(body.note ? { note: body.note } : {}),
            };
      const row = await audited(prisma, (tx) => transitionFarmer(tx, source, decision, auth));
      return ok(present(row, auth));
    },
  },
});
