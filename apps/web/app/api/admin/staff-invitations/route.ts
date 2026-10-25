import {
  PLATFORM,
  STAFF_INVITATION_TTL_MS,
  type StaffInvitationInput,
  type StaffInvitationView,
  covers,
  staffInvitationSchema,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { conflict } from '../../../../lib/api/errors';
import { requirePermission, requirePermissionCoverage } from '../../../../lib/api/permissions';
import { created, defineRoutes, ok } from '../../../../lib/api/route';
import { requireWriter } from '../../../../lib/api/scope';
import { isUniqueViolation, requireStatesExist } from '../../../../lib/api/staff-access';
import {
  STAFF_INVITATION_SELECT,
  type StaffInvitationRow,
  hashStaffInvitationToken,
  newStaffInvitationToken,
  presentStaffInvitation,
  sendStaffInvitationEmail,
  staffInvitationLink,
} from '../../../../lib/api/staff-invitations';
import { prisma } from '../../../../lib/db';

/**
 * STAFF INVITATIONS (2026-10-28, lane-security). The specification: "Staff and
 * Permissions: Invitations, multiple roles, granular powers ...".
 *
 * GET   the latest 100 invitations the caller may manage: all of them for a
 *       platform-wide holder of "Manage staff permissions"; for a holder
 *       limited to states, invitations to those states only. Addresses are
 *       masked.
 * POST  invite { name, email, role, state_id? }: an expiring (7 days) link by
 *       email; the invitee chooses their own password (POST
 *       /api/staff-invitations/accept). Inviting an administrator needs the
 *       permission platform-wide; a state-scoped role, over that state.
 *       Audited `staff.invited` (role and state; never the address). The link
 *       is in this one answer, so the inviter can pass it on if the email
 *       could not be sent.
 *
 * Administrators only, then `staff.manage`. An open invitation that has
 * expired is withdrawn automatically when the same address is invited again.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth }) => {
      const { coverage } = await requirePermissionCoverage(auth, 'staff.manage');
      const rows = await prisma.$queryRawUnsafe<StaffInvitationRow[]>(
        `${STAFF_INVITATION_SELECT}
          ORDER BY i.created_at DESC, i.id DESC
          LIMIT 100`,
      );
      const visible = rows.filter((r) =>
        r.scope_state_id === null
          ? coverage.platform
          : covers(coverage, { kind: 'states', stateIds: [r.scope_state_id] }),
      );
      return ok(visible.map((r) => presentStaffInvitation(r)));
    },
  },

  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: staffInvitationSchema,
    handler: async ({ auth, body: raw, request }) => {
      const body = raw as StaffInvitationInput;
      requireWriter(auth);
      await requirePermission(
        auth,
        'staff.manage',
        body.state_id ? { kind: 'states', stateIds: [body.state_id] } : PLATFORM,
      );
      if (body.state_id) await requireStatesExist([body.state_id]);

      const token = newStaffInvitationToken();
      const expiresAt = new Date(Date.now() + STAFF_INVITATION_TTL_MS);

      let row: StaffInvitationRow;
      try {
        row = await audited(prisma, async (tx) => {
          // An expired, unanswered invitation to the same address is withdrawn
          // first, so the address can be invited again.
          await tx.$executeRawUnsafe(
            `UPDATE public.staff_invitation
                SET revoked_at = now(), revoked_by = $2::uuid
              WHERE email = $1 AND accepted_at IS NULL AND revoked_at IS NULL
                AND expires_at <= now()`,
            body.email,
            auth.principal.id,
          );
          const [inserted] = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO public.staff_invitation
               (token_hash, email, name, role, scope_state_id, invited_by, expires_at)
             VALUES ($1, $2, $3, $4::public.user_role, $5, $6::uuid, $7::timestamptz)
             RETURNING id`,
            hashStaffInvitationToken(token),
            body.email,
            body.name,
            body.role,
            body.state_id ?? null,
            auth.principal.id,
            expiresAt.toISOString(),
          );
          const id = (inserted as { id: string }).id;
          await writeAudit(tx, {
            entityType: 'staff_invitation',
            entityId: id,
            actorType: auth.role,
            actorId: auth.principal.id,
            action: 'staff.invited',
            after: {
              role: body.role,
              state_id: body.state_id ?? null,
              expires_at: expiresAt.toISOString(),
            },
          });
          const [fresh] = await tx.$queryRawUnsafe<StaffInvitationRow[]>(
            `${STAFF_INVITATION_SELECT} WHERE i.id = $1::uuid`,
            id,
          );
          return fresh as StaffInvitationRow;
        });
      } catch (failure) {
        if (isUniqueViolation(failure, 'staff_invitation_one_open')) {
          throw conflict('staff_invitation_pending');
        }
        throw failure;
      }

      const link = staffInvitationLink(request, token);
      const emailSent = await sendStaffInvitationEmail({
        email: body.email,
        name: body.name,
        role: body.role,
        inviterName: auth.principal.name,
        link,
      });
      const answer: StaffInvitationView = {
        ...presentStaffInvitation(row),
        email_sent: emailSent,
        link,
      };
      return created(answer);
    },
  },
});
