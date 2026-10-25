import {
  BUYER_ROLE,
  FARMER_ROLE,
  ORG_INVITATION_DAYS,
  ORG_PERMISSIONS,
  offerTransferSchema,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { unprocessable } from '../../../../../lib/api/errors';
import { checkId } from '../../../../../lib/api/market-posts';
import { notifyAccount } from '../../../../../lib/api/notify';
import {
  INVITATION_SELECT,
  actorFor,
  loadMembers,
  lockTeam,
  personOf,
  presentInvitation,
  requireMember,
  type InvitationRow,
} from '../../../../../lib/api/organizations';
import { created, defineRoutes } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/organizations/:id/transfer -- offer administration to another
 * current member (2026-10-27). `team.manage`.
 *
 * "Support multiple managers, transfer with recipient acceptance." Nothing
 * changes until the member accepts (POST /api/organizations/invitations).
 * The offering administrator says now what they become then: still an
 * administrator (sharing it -- two administrators, as the specification
 * encourages), a contributor, a viewer, or leaving. One open offer per member.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: offerTransferSchema,
    handler: async ({ auth, params, body }) => {
      const me = personOf(auth);
      const id = checkId(params.id);
      const result = await audited(prisma, async (tx) => {
        await lockTeam(tx, id);
        const { member } = await requireMember(tx, id, me, {
          permission: 'team.manage',
          open: true,
        });
        const members = await loadMembers(tx, id);
        const target = members.find((m) => m.id === body.member_id && m.status === 'active');
        if (!target || target.id === member.id || target.preset === 'administrator') {
          throw unprocessable('organization_transfer_not_member');
        }
        const [waiting] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM public.organization_invitation
            WHERE target_member_id = $1::uuid AND status = 'pending' AND expires_at > now()`,
          target.id,
        );
        if (waiting) throw unprocessable('organization_transfer_pending');
        const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.organization_invitation
             (organization_id, kind, target_member_id, preset, permissions, sender_after,
              expires_at, delivery, invited_by, invited_by_member_id)
           VALUES ($1::uuid, 'transfer', $2::uuid, 'administrator', $3::text[], $4,
                   now() + make_interval(days => $5::int), 'in_app', $6::uuid, $7::uuid)
           RETURNING id`,
          id,
          target.id,
          [...ORG_PERMISSIONS],
          body.sender_after,
          ORG_INVITATION_DAYS,
          me,
          member.id,
        );
        await writeAudit(tx, {
          entityType: 'organization_invitation',
          entityId: row!.id,
          ...actorFor(auth),
          action: 'organization_transfer.offered',
          after: {
            organization_id: id,
            target_member_id: target.id,
            sender_after: body.sender_after,
          },
        });
        await notifyAccount(
          tx,
          { authUserId: target.auth_user_id },
          'organization_transfer_offered',
          actorFor(auth),
        );
        const [stored] = await tx.$queryRawUnsafe<InvitationRow[]>(
          `${INVITATION_SELECT} WHERE i.id = $1::uuid`,
          row!.id,
        );
        return presentInvitation(stored!, new Date(), true);
      });
      return created(result);
    },
  },
});
