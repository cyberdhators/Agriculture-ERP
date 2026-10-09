import { BUYER_ROLE, FARMER_ROLE, emptyBodySchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { issueRecoveryCode } from '../../../../lib/api/recovery';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * POST /api/account/recovery-code -- a signed-in farmer or buyer gets a new
 * recovery code (2026-10-09): for an account made before codes existed, or one
 * whose code was lost. The new code replaces the old, which stops working, and
 * is returned once. The audit says a code was issued, never the code.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [BUYER_ROLE, FARMER_ROLE],
    bodySchema: emptyBodySchema,
    handler: async ({ auth }) => {
      const kind = auth.role === FARMER_ROLE ? 'farmer' : 'buyer';
      const code = await audited(prisma, async (tx) => {
        const issued = await issueRecoveryCode(tx, auth.principal.authUserId);
        await writeAudit(tx, {
          entityType: kind,
          entityId: auth.principal.id,
          actorType: kind,
          actorId: auth.principal.id,
          action: kind === 'farmer' ? 'farmer.updated' : 'buyer.updated',
          after: { sign_in: 'recovery_code_issued' },
        });
        return issued;
      });
      return ok({ recovery_code: code });
    },
  },
});
