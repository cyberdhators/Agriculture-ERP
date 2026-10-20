import { BUYER_ROLE, FARMER_ROLE, emptyBodySchema } from '@agri-erp/shared';

import { loadOwnProvider } from '../../../../../../lib/api/advice';
import {
  APPLICATION_COLUMNS,
  openApplicationOf,
  presentOwnApplication,
  type ApplicationRow,
} from '../../../../../../lib/api/adviser-approval';
import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { unprocessable } from '../../../../../../lib/api/errors';
import { actorOf, me } from '../../../../../../lib/api/messaging';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';

/**
 * POST /api/advice/my-provider/application/withdraw {} -- the applicant
 * withdraws the application that is with CORWADO (2026-10-24): submitted or
 * waiting for their answer. Withdrawn is final for that application; they may
 * apply again later. An approval is not withdrawn here -- it is CORWADO's to
 * revoke -- and the advice profile itself is untouched.
 *
 * Audited as `adviser_application.withdrawn` with the statuses only.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: emptyBodySchema,
    handler: async ({ auth }) => {
      const owner = me(auth);
      const row = await audited(prisma, async (tx) => {
        const provider = await loadOwnProvider(tx, owner, true);
        const open = provider ? await openApplicationOf(tx, provider.id) : null;
        if (!open) throw unprocessable('adviser_nothing_to_withdraw');
        const [changed] = await tx.$queryRawUnsafe<ApplicationRow[]>(
          `UPDATE public.adviser_application a
              SET status = 'withdrawn', updated_at = now()
            WHERE a.id = $1::uuid
            RETURNING ${APPLICATION_COLUMNS}`,
          open.id,
        );
        await writeAudit(tx, {
          entityType: 'adviser_application',
          entityId: open.id,
          ...actorOf(auth),
          action: 'adviser_application.withdrawn',
          before: { status: open.status },
          after: { status: 'withdrawn' },
        });
        return changed;
      });
      if (!row) throw unprocessable('adviser_nothing_to_withdraw'); // unreachable: just written
      return ok(presentOwnApplication(row));
    },
  },
});
