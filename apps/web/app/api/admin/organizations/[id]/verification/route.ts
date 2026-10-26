import {
  ORGANIZATION_VERIFY_PERMISSION,
  orgVerificationAuditAction,
  orgVerificationDecision,
  organizationVerificationSchema,
  type OrgVerificationStatus,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../../lib/api/errors';
import { checkId } from '../../../../../../lib/api/market-posts';
import { requirePermission } from '../../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';

/**
 * POST /api/admin/organizations/:id/verification -- staff VERIFY an
 * organisational profile, or remove the mark (2026-10-31). The owner: "only
 * organization needs to be verified by admin and superadmin not individual."
 * docs/DECISIONS.md, "Only organisations are verified (2026-10-31)".
 *
 * `organization.verify`, held through the Administrator and Super Admin
 * presets, platform-wide. Body: `verified` true or false, and a `note` --
 * optional when verifying (what was checked), required when removing the mark
 * (the reason). The note is kept on the profile and in the audit.
 *
 * A BADGE ONLY. Nothing reads verification_status to allow or refuse
 * anything: an unverified organisation works normally. A closed organisation
 * is refused (its record is final), and a decision that changes nothing is
 * refused rather than written twice. Audited as `organization.verified` or
 * `organization.verification_removed`.
 *
 * Organisational administrators cannot reach this: it is a staff route, and an
 * organisation's own permissions never include a staff permission
 * (CORWADO's specification: "Organisational administrators cannot award
 * AgriOne verification ... to their staff").
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: organizationVerificationSchema,
    handler: async ({ auth, params, body }) => {
      await requirePermission(auth, ORGANIZATION_VERIFY_PERMISSION);
      const id = checkId(params.id);

      const result = await audited(prisma, async (tx) => {
        const [current] = await tx.$queryRawUnsafe<
          { verification_status: OrgVerificationStatus; closed: boolean }[]
        >(
          `SELECT verification_status, (closed_at IS NOT NULL) AS closed
             FROM public.organization
            WHERE id = $1::uuid AND deleted_at IS NULL
            FOR UPDATE`,
          id,
        );
        if (!current) throw notFound();
        const decision = orgVerificationDecision({
          current: current.verification_status,
          closed: current.closed,
          verified: body.verified,
        });
        if (!decision.allowed) throw unprocessable(decision.reason);

        const [row] = await tx.$queryRawUnsafe<
          { verification_status: OrgVerificationStatus; verified_at: Date | null }[]
        >(
          `UPDATE public.organization
              SET verification_status = $2::text,
                  verified_at = CASE WHEN $2::text = 'verified' THEN now() ELSE NULL END,
                  verified_by = CASE WHEN $2::text = 'verified' THEN $3::uuid ELSE NULL END,
                  verification_note = $4::text,
                  updated_at = now()
            WHERE id = $1::uuid
            RETURNING verification_status, verified_at`,
          id,
          decision.to,
          auth.principal.id,
          body.note ?? null,
        );
        await writeAudit(tx, {
          entityType: 'organization',
          entityId: id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: orgVerificationAuditAction(decision.to),
          before: { verification_status: current.verification_status },
          after: { verification_status: decision.to, note: body.note ?? null },
        });
        return row!;
      });

      return ok({
        id,
        verification_status: result.verification_status,
        verified_at: result.verified_at ? result.verified_at.toISOString() : null,
      });
    },
  },
});
