import {
  BUYER_ROLE,
  FARMER_ROLE,
  ORG_INVITATION_DAYS,
  ORG_PRESET_LABELS,
  inviteMemberSchema,
  type OrgPreset,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { unprocessable } from '../../../../../lib/api/errors';
import { checkId } from '../../../../../lib/api/market-posts';
import { notifyAccount } from '../../../../../lib/api/notify';
import {
  INVITATION_SELECT,
  accountForPhone,
  activeMembership,
  actorFor,
  deliverInvitation,
  hashInvitationToken,
  invitationLink,
  lockTeam,
  newInvitationToken,
  personOf,
  presentInvitation,
  requireMember,
  type InvitationRow,
} from '../../../../../lib/api/organizations';
import { created, defineRoutes, paged } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * /api/organizations/:id/invitations -- inviting people (2026-10-27).
 * `team.manage` for both methods.
 *
 * GET: the organisation's invitations and handover offers, newest first, with
 * where each was sent and whether it is pending, expired or answered.
 *
 * POST: invite a phone or an email with a preset and permissions. The
 * recipient sees the organisation, the role and the permissions before
 * accepting, and can accept only when signed in as that phone or email.
 *
 * DELIVERY. The answer carries the invitation LINK, once (only its hash is
 * stored), for the inviter to copy and send. When SMS (Bird) or email
 * (Resend) is configured the link is also sent there, and the outcome is
 * recorded on the invitation; a failed send never undoes it. An account that
 * already signs in with that phone gets an in-app notice; every recipient
 * sees it in Organisations when signed in as the invited phone or email.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params }) => {
      const me = personOf(auth);
      const id = checkId(params.id);
      await requireMember(prisma, id, me, { permission: 'team.manage' });
      const rows = await prisma.$queryRawUnsafe<InvitationRow[]>(
        `${INVITATION_SELECT} WHERE i.organization_id = $1::uuid
          ORDER BY i.created_at DESC, i.id DESC LIMIT 100`,
        id,
      );
      const now = new Date();
      return paged(
        rows.map((row) => presentInvitation(row, now, true)),
        { cursor: null, hasMore: false },
      );
    },
  },

  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: inviteMemberSchema,
    handler: async ({ auth, params, body, request }) => {
      const me = personOf(auth);
      const id = checkId(params.id);
      const token = newInvitationToken();
      const link = invitationLink(request, token);

      const invitation = await audited(prisma, async (tx) => {
        await lockTeam(tx, id);
        const { organization, member } = await requireMember(tx, id, me, {
          permission: 'team.manage',
          open: true,
        });
        // A phone that already belongs to a member is not invited twice.
        const existingAccount =
          body.channel === 'phone' ? await accountForPhone(tx, body.target) : null;
        if (existingAccount && (await activeMembership(tx, id, existingAccount))) {
          throw unprocessable('organization_already_member');
        }
        const [waiting] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM public.organization_invitation
            WHERE organization_id = $1::uuid AND kind = 'member' AND target = $2
              AND status = 'pending' AND expires_at > now()`,
          id,
          body.target,
        );
        if (waiting) throw unprocessable('organization_invitation_pending');

        const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.organization_invitation
             (organization_id, kind, channel, target, preset, permissions, token_hash,
              expires_at, invited_by, invited_by_member_id)
           VALUES ($1::uuid, 'member', $2, $3, $4, $5::text[], $6,
                   now() + make_interval(days => $7::int), $8::uuid, $9::uuid)
           RETURNING id`,
          id,
          body.channel,
          body.target,
          body.preset,
          body.permissions,
          hashInvitationToken(token),
          ORG_INVITATION_DAYS,
          me,
          member.id,
        );
        const delivery = await deliverInvitation({
          channel: body.channel,
          target: body.target,
          organizationName: organization.name,
          presetLabel: ORG_PRESET_LABELS[body.preset as OrgPreset],
          link,
        });
        if (delivery !== 'link_only') {
          await tx.$queryRawUnsafe(
            `UPDATE public.organization_invitation SET delivery = $2 WHERE id = $1::uuid`,
            row!.id,
            delivery,
          );
        }
        // The target is a phone or an email: it never enters the audit row.
        await writeAudit(tx, {
          entityType: 'organization_invitation',
          entityId: row!.id,
          ...actorFor(auth),
          action: 'organization_invitation.created',
          after: {
            organization_id: id,
            channel: body.channel,
            preset: body.preset,
            permissions: body.permissions,
            delivery,
          },
        });
        if (existingAccount) {
          await notifyAccount(
            tx,
            { authUserId: existingAccount },
            'organization_invitation',
            actorFor(auth),
          );
        }
        const [stored] = await tx.$queryRawUnsafe<InvitationRow[]>(
          `${INVITATION_SELECT} WHERE i.id = $1::uuid`,
          row!.id,
        );
        return presentInvitation(stored!, new Date(), true);
      });
      return created({ invitation, link });
    },
  },
});
