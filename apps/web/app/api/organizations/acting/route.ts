import { BUYER_ROLE, FARMER_ROLE, actingAsSchema, type ActingAs } from '@agri-erp/shared';

import { notFound, unprocessable } from '../../../../lib/api/errors';
import {
  actingCookie,
  activeMembership,
  loadOrganization,
  personOf,
  resolveActing,
} from '../../../../lib/api/organizations';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * /api/organizations/acting -- who the caller is acting as (2026-10-27).
 *
 * GET answers from the cookie, re-checked against the membership. A cookie for
 * an organisation the caller no longer belongs to is cleared here and read as
 * "yourself", so the page can say so; every OTHER route refuses such a cookie
 * (organization_access_ended) rather than act on it.
 *
 * POST switches: an organisation the caller is an active member of, and which
 * is open -- or null for themselves. The cookie is set only after that check
 * and is checked again on every request that uses it. Switching is not a
 * change to any record, so it is not audited; what is done while acting is.
 */
const personal: ActingAs = {
  organization_id: null,
  organization_name: null,
  preset: null,
  permissions: [],
};

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, request }) => {
      const acting = await resolveActing(prisma, request, auth);
      if (acting === 'ended') {
        return ok({ ...personal, access_ended: true }, { 'set-cookie': actingCookie(null) });
      }
      if (!acting) return ok(personal);
      return ok({
        organization_id: acting.organizationId,
        organization_name: acting.name,
        preset: acting.member.preset,
        permissions: acting.member.permissions,
      } satisfies ActingAs);
    },
  },

  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: actingAsSchema,
    handler: async ({ auth, body }) => {
      const me = personOf(auth);
      if (body.organization_id === null) {
        return ok(personal, { 'set-cookie': actingCookie(null) });
      }
      const organization = await loadOrganization(prisma, body.organization_id);
      const member = await activeMembership(prisma, organization.id, me);
      if (!member) throw notFound();
      if (organization.closed_at) throw unprocessable('organization_closed');
      return ok(
        {
          organization_id: organization.id,
          organization_name: organization.name,
          preset: member.preset,
          permissions: member.permissions,
        } satisfies ActingAs,
        { 'set-cookie': actingCookie(organization.id) },
      );
    },
  },
});
