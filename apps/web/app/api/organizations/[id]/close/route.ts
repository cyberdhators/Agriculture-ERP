import { BUYER_ROLE, FARMER_ROLE, closeOrganizationSchema } from '@agri-erp/shared';

import { audited } from '../../../../../lib/api/audit';
import { checkId } from '../../../../../lib/api/market-posts';
import { notifyAccount } from '../../../../../lib/api/notify';
import {
  actingCookie,
  actorFor,
  closeOrganization,
  loadMembers,
  lockTeam,
  personOf,
  requestedOrganization,
  requireMember,
} from '../../../../../lib/api/organizations';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/organizations/:id/close -- organisational closure (2026-10-27).
 * `team.manage`, a reason and an explicit yes.
 *
 * The specification protects the last administrator "through transfer or
 * organizational closure". Closing needs nobody else's agreement, which is
 * what keeps a departing administrator from depending on another person.
 * Records stay: posts are withdrawn, conversations closed, every membership
 * ended (each other member is told in the app), pending invitations
 * cancelled. lib/api/organizations.ts closeOrganization.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: closeOrganizationSchema,
    handler: async ({ auth, params, body, request }) => {
      const me = personOf(auth);
      const id = checkId(params.id);
      await audited(prisma, async (tx) => {
        await lockTeam(tx, id);
        await requireMember(tx, id, me, { permission: 'team.manage', open: true, lock: true });
        const others = (await loadMembers(tx, id)).filter(
          (m) => m.status === 'active' && m.auth_user_id !== me,
        );
        await closeOrganization(tx, {
          organizationId: id,
          closedBy: me,
          reason: body.reason,
          actor: actorFor(auth),
        });
        for (const other of others) {
          await notifyAccount(
            tx,
            { authUserId: other.auth_user_id },
            'organization_access_ended',
            actorFor(auth),
          );
        }
      });
      const headers =
        requestedOrganization(request) === id ? { 'set-cookie': actingCookie(null) } : undefined;
      return ok({ closed: true }, headers);
    },
  },
});
