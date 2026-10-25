import {
  BUYER_ROLE,
  FARMER_ROLE,
  ORG_PERMISSIONS,
  ORGANIZATION_MESSAGES,
  acceptIssue,
  invitationIsFor,
  permissionsFor,
  respondInvitationSchema,
  senderPresetAfter,
} from '@agri-erp/shared';

import { audited, writeAudit, type AuditTx } from '../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../lib/api/errors';
import { invalidField } from '../../../../lib/api/market-posts';
import {
  INVITATION_SELECT,
  actorFor,
  activeMembership,
  callerContacts,
  hashInvitationToken,
  lockTeam,
  personOf,
  presentInvitation,
  type InvitationRow,
} from '../../../../lib/api/organizations';
import { defineRoutes, ok, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * /api/organizations/invitations -- the caller's own invitations (2026-10-27).
 *
 * GET with no query: every PENDING invitation sent to the phone or email the
 * caller is signed in with, and every offer of administration made to one of
 * their memberships. With `?token=`: the one invitation behind a link, so the
 * invitation page can disclose the organisation, the role and its
 * permissions BEFORE anything is accepted; `for_me` says whether the caller
 * is signed in as its recipient.
 *
 * POST answers one, by the link's token or by its id. Only the recipient --
 * signed in as the invited phone or email, or the member the handover was
 * offered to -- may accept OR decline; anyone else holding the link gets
 * organization_invitation_other_account. Accepting a member invitation makes
 * the membership with exactly the preset and permissions that were disclosed.
 * Accepting a handover makes the member an Administrator and gives the
 * offering administrator what they chose (administrator, contributor, viewer
 * or leave). Each step is audited with the person as the actor.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, request }) => {
      const me = personOf(auth);
      const now = new Date();
      const token = new URL(request.url).searchParams.get('token');
      const contacts = await callerContacts(prisma, me);

      if (token !== null) {
        if (!TOKEN.test(token)) throw invalidField('token', ORGANIZATION_MESSAGES.tokenInvalid);
        const [row] = await prisma.$queryRawUnsafe<InvitationRow[]>(
          `${INVITATION_SELECT} WHERE i.token_hash = $1`,
          hashInvitationToken(token),
        );
        if (!row) throw notFound();
        const forMe = invitationIsFor(
          {
            kind: row.kind,
            status: row.status,
            channel: row.channel,
            target: row.target,
            expiresAt: row.expires_at,
          },
          contacts,
        );
        return ok({
          ...presentInvitation(row, now, false),
          for_me: forMe,
          // Which kind of sign-in it needs, never the address itself.
          needs: row.channel,
        });
      }

      const rows = await prisma.$queryRawUnsafe<InvitationRow[]>(
        `${INVITATION_SELECT}
          WHERE i.status = 'pending' AND i.expires_at > now() AND o.closed_at IS NULL
            AND (
              (i.kind = 'member' AND i.channel = 'phone' AND i.target = $1)
              OR (i.kind = 'member' AND i.channel = 'email' AND i.target = $2)
              OR (i.kind = 'transfer' AND tm.auth_user_id = $3::uuid AND tm.status = 'active')
            )
          ORDER BY i.created_at DESC, i.id DESC
          LIMIT 50`,
        contacts.phone ?? '',
        contacts.email ?? '',
        me,
      );
      return paged(
        rows.map((row) => ({ ...presentInvitation(row, now, false), for_me: true })),
        { cursor: null, hasMore: false },
      );
    },
  },

  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: respondInvitationSchema,
    handler: async ({ auth, body }) => {
      const me = personOf(auth);
      // An HTTP call to Supabase: before the transaction, never inside it.
      const contacts = await callerContacts(prisma, me);
      const actor = actorFor(auth);

      const result = await audited(prisma, async (tx) => {
        const [found] = await tx.$queryRawUnsafe<{ id: string; organization_id: string }[]>(
          body.token !== undefined
            ? `SELECT id, organization_id FROM public.organization_invitation WHERE token_hash = $1`
            : `SELECT id, organization_id FROM public.organization_invitation WHERE id = $1::uuid`,
          body.token !== undefined ? hashInvitationToken(body.token) : body.invitation_id,
        );
        if (!found) throw notFound();
        await lockTeam(tx, found.organization_id);
        await tx.$queryRawUnsafe(
          `SELECT id FROM public.organization_invitation WHERE id = $1::uuid FOR UPDATE`,
          found.id,
        );
        const [row] = await tx.$queryRawUnsafe<(InvitationRow & { closed: boolean })[]>(
          `${INVITATION_SELECT.replace(
            'i.invited_by_member_id',
            'i.invited_by_member_id, (o.closed_at IS NOT NULL) AS closed',
          )} WHERE i.id = $1::uuid`,
          found.id,
        );
        if (!row) throw notFound();
        const invitation = {
          kind: row.kind,
          status: row.status,
          channel: row.channel,
          target: row.target,
          expiresAt: row.expires_at,
          targetMemberAuthUserId: row.target_member_auth_user_id,
        };

        if (!body.accept) {
          if (!invitationIsFor(invitation, contacts)) {
            throw unprocessable('organization_invitation_other_account');
          }
          if (row.status !== 'pending') throw unprocessable('organization_invitation_not_pending');
          await tx.$queryRawUnsafe(
            `UPDATE public.organization_invitation
                SET status = 'declined', responded_by = $2::uuid, responded_at = now(),
                    updated_at = now()
              WHERE id = $1::uuid`,
            row.id,
            me,
          );
          await writeAudit(tx, {
            entityType: 'organization_invitation',
            entityId: row.id,
            ...actor,
            action:
              row.kind === 'transfer'
                ? 'organization_transfer.declined'
                : 'organization_invitation.declined',
            before: { status: 'pending' },
            after: { status: 'declined', organization_id: row.organization_id },
          });
          return { accepted: false, organization_id: row.organization_id };
        }

        const mine = await activeMembership(tx, row.organization_id, me, true);
        const issue = acceptIssue({
          invitation,
          caller: contacts,
          now: new Date(),
          alreadyMember: mine !== null,
        });
        if (issue) throw unprocessable(issue);
        if (row.closed) throw unprocessable('organization_closed');

        if (row.kind === 'member') {
          await acceptMember(tx, row, me, actor);
        } else {
          if (!mine || mine.id !== row.target_member_id) {
            throw unprocessable('organization_transfer_not_member');
          }
          await acceptTransfer(tx, row, mine.id, actor);
        }
        await tx.$queryRawUnsafe(
          `UPDATE public.organization_invitation
              SET status = 'accepted', responded_by = $2::uuid, responded_at = now(),
                  updated_at = now()
            WHERE id = $1::uuid`,
          row.id,
          me,
        );
        await writeAudit(tx, {
          entityType: 'organization_invitation',
          entityId: row.id,
          ...actor,
          action:
            row.kind === 'transfer'
              ? 'organization_transfer.accepted'
              : 'organization_invitation.accepted',
          before: { status: 'pending' },
          after: { status: 'accepted', organization_id: row.organization_id, preset: row.preset },
        });
        return { accepted: true, organization_id: row.organization_id };
      });
      return ok(result);
    },
  },
});

type Actor = ReturnType<typeof actorFor>;

/** The membership the invitation disclosed: its preset, its permissions, nothing more. */
async function acceptMember(tx: AuditTx, row: InvitationRow, me: string, actor: Actor) {
  const permissions = permissionsFor(row.preset, row.permissions) ?? [];
  const [inviter] = await tx.$queryRawUnsafe<{ auth_user_id: string }[]>(
    `SELECT auth_user_id FROM public.organization_member WHERE id = $1::uuid`,
    row.invited_by_member_id,
  );
  const [member] = await tx.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO public.organization_member
       (organization_id, auth_user_id, preset, permissions, invitation_id, invited_by)
     VALUES ($1::uuid, $2::uuid, $3, $4::text[], $5::uuid, $6::uuid)
     RETURNING id`,
    row.organization_id,
    me,
    row.preset,
    permissions,
    row.id,
    inviter?.auth_user_id ?? null,
  );
  await writeAudit(tx, {
    entityType: 'organization_member',
    entityId: member!.id,
    ...actor,
    action: 'organization_member.joined',
    after: {
      organization_id: row.organization_id,
      preset: row.preset,
      permissions,
      invitation_id: row.id,
    },
  });
}

/** The handover: the member becomes an Administrator; the offerer becomes what they chose. */
async function acceptTransfer(tx: AuditTx, row: InvitationRow, targetId: string, actor: Actor) {
  await tx.$queryRawUnsafe(
    `UPDATE public.organization_member
        SET preset = 'administrator', permissions = $2::text[], updated_at = now()
      WHERE id = $1::uuid`,
    targetId,
    [...ORG_PERMISSIONS],
  );
  await writeAudit(tx, {
    entityType: 'organization_member',
    entityId: targetId,
    ...actor,
    action: 'organization_member.updated',
    after: { organization_id: row.organization_id, preset: 'administrator', by: 'handover' },
  });

  const after = row.sender_after ?? 'administrator';
  const [sender] = await tx.$queryRawUnsafe<{ id: string; status: string; preset: string }[]>(
    `SELECT id, status, preset FROM public.organization_member WHERE id = $1::uuid FOR UPDATE`,
    row.invited_by_member_id,
  );
  // The offerer may have left or been removed since: then there is nothing to change.
  if (!sender || sender.status !== 'active' || sender.id === targetId) return;
  const preset = senderPresetAfter(after);
  if (preset === null) {
    await tx.$queryRawUnsafe(
      `UPDATE public.organization_member
          SET status = 'left', ended_at = now(), ended_by = auth_user_id,
              end_reason = 'Handed over administration.', updated_at = now()
        WHERE id = $1::uuid`,
      sender.id,
    );
    await writeAudit(tx, {
      entityType: 'organization_member',
      entityId: sender.id,
      ...actor,
      action: 'organization_member.left',
      before: { status: 'active' },
      after: { status: 'left', organization_id: row.organization_id, by: 'handover' },
    });
  } else if (preset !== sender.preset) {
    await tx.$queryRawUnsafe(
      `UPDATE public.organization_member SET preset = $2, permissions = $3::text[],
              updated_at = now()
        WHERE id = $1::uuid`,
      sender.id,
      preset,
      permissionsFor(preset) ?? [],
    );
    await writeAudit(tx, {
      entityType: 'organization_member',
      entityId: sender.id,
      ...actor,
      action: 'organization_member.updated',
      before: { preset: sender.preset },
      after: { preset, organization_id: row.organization_id, by: 'handover' },
    });
  }
}
