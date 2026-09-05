import { audited } from '../../../../../lib/api/audit';
import { loadVisible, present } from '../../../../../lib/api/farmers';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import { type Decision, transitionFarmer } from '../../../../../lib/api/verification';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/farmers/:id/resubmit (C-6). Scope first: a farmer outside the
 * caller's scope is a 404 before any decision is considered. The state
 * machine in lib/api/verification.ts decides whether the record may take the
 * decision; this route only names it.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['officer'],
    handler: async ({ auth, params }) => {
      requireWriter(auth);
      const source = await loadVisible(prisma, params.id ?? '', auth);
      const decision: Decision = { kind: 'resubmit' };
      const row = await audited(prisma, (tx) => transitionFarmer(tx, source, decision, auth));
      return ok(present(row, auth));
    },
  },
});
