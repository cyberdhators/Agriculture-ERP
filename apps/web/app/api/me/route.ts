import { ALL_ROLES, BUYER_ROLE } from '@agri-erp/shared';

import { defineRoutes, ok } from '../../../lib/api/route';

/**
 * Who am I, and what may I see.
 *
 * Any authenticated principal. A principal whose row was soft-deleted, or an
 * officer set inactive, gets 401 on their very next request -- requireRole reads
 * the active views, so there is nothing to find. C-3.6.
 *
 * B13: a buyer too, named explicitly because ALL_ROLES deliberately excludes
 * one. Sign-in reads `role` from here to send a buyer to /buyer/dashboard.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [...ALL_ROLES, BUYER_ROLE],
    handler: async ({ auth }) =>
      ok({
        id: auth.principal.id,
        kind: auth.principal.kind,
        name: auth.principal.name,
        role: auth.role,
        scope: auth.scope,
      }),
  },
});
