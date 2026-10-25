import { BUYER_ROLE, FARMER_ROLE, myMembershipSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { checkId } from '../../../../../lib/api/market-posts';
import {
  actorFor,
  loadMembers,
  personOf,
  presentMember,
  requireMember,
} from '../../../../../lib/api/organizations';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * PATCH /api/organizations/:id/membership -- the member's OWN choices
 * (2026-10-27): whether they appear on the organisation's public profile, and
 * the title shown there. The specification: "Public team/contact details are
 * optional and require the person's agreement." So only the person sets
 * `show_on_profile`; no administrator can.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: myMembershipSchema,
    handler: async ({ auth, params, body }) => {
      const me = personOf(auth);
      const id = checkId(params.id);
      const result = await audited(prisma, async (tx) => {
        const { member } = await requireMember(tx, id, me, { open: true, lock: true });
        const showOnProfile = body.show_on_profile ?? member.show_on_profile;
        const title = body.public_title !== undefined ? body.public_title : member.public_title;
        await tx.$queryRawUnsafe(
          `UPDATE public.organization_member
              SET show_on_profile = $2, public_title = $3, updated_at = now()
            WHERE id = $1::uuid`,
          member.id,
          showOnProfile,
          title ?? null,
        );
        await writeAudit(tx, {
          entityType: 'organization_member',
          entityId: member.id,
          ...actorFor(auth),
          action: 'organization_member.updated',
          before: { show_on_profile: member.show_on_profile, public_title: member.public_title },
          after: { show_on_profile: showOnProfile, public_title: title ?? null, by: 'self' },
        });
        const updated = (await loadMembers(tx, id)).find((m) => m.id === member.id)!;
        return presentMember(updated, me);
      });
      return ok(result);
    },
  },
});
