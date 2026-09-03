import { ALL_ROLES } from '@agri-erp/shared';

import { defineRoutes, ok } from '../../../lib/api/route';

/**
 * Who am I, and what may I see.
 *
 * Any authenticated principal. A principal whose row was soft-deleted, or an
 * officer set inactive, gets 401 on their very next request -- requireRole reads
 * the active views, so there is nothing to find. C-3.6.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ALL_ROLES,
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
