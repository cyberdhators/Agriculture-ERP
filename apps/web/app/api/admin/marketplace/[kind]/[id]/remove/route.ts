import { marketplaceRemoveSchema } from '@agri-erp/shared';

import {
  KIND_TABLE,
  REMOVE_TARGET_SQL,
  kindOf,
} from '../../../../../../../lib/api/admin-marketplace';
import { audited, writeAudit } from '../../../../../../../lib/api/audit';
import { notFound } from '../../../../../../../lib/api/errors';
import {
  checkListingReasonCode,
  reasonCodesSetting,
} from '../../../../../../../lib/api/listing-corrections';
import { checkId } from '../../../../../../../lib/api/market-posts';
import { notifyAccount } from '../../../../../../../lib/api/notify';
import { requirePermission } from '../../../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../../../lib/api/route';
import { prisma } from '../../../../../../../lib/db';

/**
 * POST /api/admin/marketplace/:kind/:id/remove { reason, reason_code? } --
 * staff remove a post from the marketplace console (2026-10-28, CORWADO's
 * specification: "moderate with a reason; listing removal is separate from
 * account action"). ADMINISTRATOR ONLY, then `content.moderate`.
 *
 * In one transaction: the post is SOFT-deleted (deleted_at, deleted_by --
 * the deletion law; no route restores a removed post), one audit row
 * `listing.removed` carrying the kind, the title, the written reason and the
 * code, and ONE fixed in-app notice to the owner (`listing_removed`; the
 * reason is never in a notice). THE ACCOUNT IS NOT TOUCHED: suspending or
 * disabling it is a separate decision on the account's own page. Open
 * reports and correction requests about the post are left as they are.
 *
 * A draft, an already removed post or an unknown kind is 404. A reason code,
 * if sent, must be an active code offered for listings.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: marketplaceRemoveSchema,
    handler: async ({ auth, body, params }) => {
      await requirePermission(auth, 'content.moderate');
      const kind = kindOf(params.kind);
      if (!kind) throw notFound();
      const id = checkId(params.id);
      if (body.reason_code)
        checkListingReasonCode(await reasonCodesSetting(prisma), body.reason_code);
      const actor = { actorType: auth.role, actorId: auth.principal.id } as const;
      const table = KIND_TABLE[kind];

      const notified = await audited(prisma, async (tx) => {
        const [target] = await tx.$queryRawUnsafe<
          {
            title: string;
            status: string;
            owner_farmer_id: string | null;
            owner_auth_user_id: string | null;
          }[]
        >(REMOVE_TARGET_SQL[kind], id);
        if (!target) throw notFound();

        await tx.$executeRawUnsafe(
          `UPDATE public.${table} SET deleted_at = now(), deleted_by = $2::uuid
            WHERE id = $1::uuid AND deleted_at IS NULL`,
          id,
          auth.principal.id,
        );
        await writeAudit(tx, {
          entityType: table,
          entityId: id,
          ...actor,
          action: 'listing.removed',
          before: { deleted_at: null, status: target.status },
          after: {
            deleted_at: 'now',
            kind,
            title: target.title,
            reason: body.reason,
            ...(body.reason_code ? { reason_code: body.reason_code } : {}),
          },
        });
        return notifyAccount(
          tx,
          { authUserId: target.owner_auth_user_id, farmerId: target.owner_farmer_id },
          'listing_removed',
          actor,
        );
      });

      return ok({ kind, id, removed: true, owner_notified: notified });
    },
  },
});
