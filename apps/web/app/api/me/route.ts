import { ALL_ROLES, BUYER_ROLE, staffMfaMode, staffMfaStatus } from '@agri-erp/shared';

import { recordVisit } from '../../../lib/api/access-log';
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
    // 2026-10-28: answered to a staff session that has not yet passed the
    // two-step code, so the portal can send it to finish signing in. It
    // returns who the caller is and nothing else.
    mfaExempt: true,
    handler: async ({ auth, request }) => {
      // STAFF PERMISSIONS LANE (2026-10-19): the access log. The portal calls
      // this on load and the sign-in screen straight after a sign-in, so it is
      // where a sign-in or a return session can be seen. recordVisit never
      // throws and gives up after two seconds: the answer below is unchanged.
      await recordVisit(auth, request);
      return ok({
        id: auth.principal.id,
        kind: auth.principal.kind,
        name: auth.principal.name,
        role: auth.role,
        scope: auth.scope,
        // 2026-10-28: staff only -- where the caller stands on two-step sign-in.
        ...(auth.mfa
          ? { mfa: staffMfaStatus(auth.mfa, staffMfaMode(process.env.STAFF_MFA_ENFORCEMENT)) }
          : {}),
      });
    },
  },
});
