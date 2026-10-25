import { USER_ROLES, staffMfaMode, staffMfaStatus } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { authUnavailable, unprocessable } from '../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';
import { verifiedFactorIds } from '../../../../lib/supabase/admin';

/**
 * A staff member's own two-step sign-in (2026-10-28, lane-security).
 *
 * GET   where the caller stands: enrolled, this session verified, what the
 *       portal must do next. The same object GET /api/me carries.
 * POST  "I have just set up an authenticator": the server confirms with the
 *       authentication service that a VERIFIED factor now exists on the
 *       caller's own account, and records `staff.mfa_enrolled`. The factor
 *       itself is created and verified in the browser, against Supabase
 *       (components/admin/StaffSecurity.tsx); this route never sees a secret
 *       or a code.
 *
 * Staff roles only. mfaExempt: these are the routes a staff session uses to
 * set up or finish two-step sign-in, so the two-step gate cannot refuse them.
 * They read and record the caller's own state and nothing else.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [...USER_ROLES],
    mfaExempt: true,
    handler: async ({ auth }) => {
      const facts = auth.mfa ?? { role: auth.role, hasVerifiedFactor: false, aal: null };
      return ok(staffMfaStatus(facts, staffMfaMode(process.env.STAFF_MFA_ENFORCEMENT)));
    },
  },

  POST: {
    roles: [...USER_ROLES],
    mfaExempt: true,
    handler: async ({ auth }) => {
      let factors: string[];
      try {
        factors = await verifiedFactorIds(auth.principal.authUserId);
      } catch {
        throw authUnavailable();
      }
      if (factors.length === 0) throw unprocessable('mfa_factor_not_verified');

      await audited(prisma, async (tx) => {
        await writeAudit(tx, {
          entityType: 'user',
          entityId: auth.principal.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'staff.mfa_enrolled',
          before: { mfa_enrolled: auth.mfa?.hasVerifiedFactor ?? false },
          after: { mfa_enrolled: true, factor_count: factors.length },
        });
      });
      return ok({ enrolled: true });
    },
  },
});
