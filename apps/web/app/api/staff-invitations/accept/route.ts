import { type AcceptStaffInvitationInput, acceptStaffInvitationSchema } from '@agri-erp/shared';

import { audited, writeAudit, writeAuditOutcome } from '../../../../lib/api/audit';
import { authUnavailable, conflict, notFound, unprocessable } from '../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { hashStaffInvitationToken } from '../../../../lib/api/staff-invitations';
import { prisma } from '../../../../lib/db';
import {
  AuthUnavailableError,
  createAuthAccount,
  deleteAuthAccount,
} from '../../../../lib/supabase/admin';

/**
 * POST /api/staff-invitations/accept { token, password } -- the invitee
 * chooses their own password and the staff account is created (2026-10-28,
 * lane-security). PUBLIC: they have no account until this succeeds.
 *
 * The same compensating transaction as POST /api/users: the authentication
 * account is created first (for the invited address, with the password the
 * invitee typed), then the staff row, the invitation marked accepted and the
 * audit entry in one database transaction. If that fails the authentication
 * account is removed again; if THAT fails, the orphan is recorded, as there.
 *
 * Refused (422) if the invitation was already used, withdrawn or has
 * expired; 404 for an unknown token. Two accepts at once: the second fails to
 * create the authentication account (the address is taken) and is refused.
 * The password is never logged, stored or audited.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: acceptStaffInvitationSchema,
    handler: async ({ body: raw }) => {
      const body = raw as AcceptStaffInvitationInput;
      const tokenHash = hashStaffInvitationToken(body.token);
      const [invitation] = await prisma.$queryRawUnsafe<
        {
          id: string;
          email: string;
          name: string;
          role: 'admin' | 'supervisor' | 'read_only';
          scope_state_id: string | null;
          pending: boolean;
        }[]
      >(
        `SELECT id, email, name, role::text AS role, scope_state_id,
                (accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS pending
           FROM public.staff_invitation WHERE token_hash = $1`,
        tokenHash,
      );
      if (!invitation) throw notFound();
      if (!invitation.pending) throw unprocessable('staff_invitation_not_pending');

      let authUserId: string;
      try {
        authUserId = await createAuthAccount(invitation.email, body.password);
      } catch (failure) {
        if (failure instanceof AuthUnavailableError) throw authUnavailable();
        throw conflict('account_already_exists');
      }

      try {
        const userId = await audited(prisma, async (tx) => {
          // Locked and re-checked inside the transaction: withdrawn or used a
          // moment ago means no account.
          const [locked] = await tx.$queryRawUnsafe<{ pending: boolean }[]>(
            `SELECT (accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS pending
               FROM public.staff_invitation WHERE id = $1::uuid FOR UPDATE`,
            invitation.id,
          );
          if (!locked?.pending) throw unprocessable('staff_invitation_not_pending');

          const [inserted] = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO public."user" (auth_user_id, name, role, scope_state_id)
             VALUES ($1::uuid, $2, $3::public.user_role, $4)
             RETURNING id`,
            authUserId,
            invitation.name,
            invitation.role,
            invitation.scope_state_id,
          );
          const id = (inserted as { id: string }).id;
          await tx.$executeRawUnsafe(
            `UPDATE public.staff_invitation SET accepted_at = now(), accepted_user_id = $2::uuid
              WHERE id = $1::uuid`,
            invitation.id,
            id,
          );
          await writeAudit(tx, {
            entityType: 'staff_invitation',
            entityId: invitation.id,
            actorType: invitation.role,
            actorId: id,
            action: 'staff.invitation_accepted',
            before: { status: 'pending' },
            after: {
              status: 'accepted',
              user_id: id,
              role: invitation.role,
              state_id: invitation.scope_state_id,
            },
          });
          return id;
        });
        return ok({ accepted: true, user_id: userId, sign_in_path: '/admin/login' });
      } catch (failure) {
        const compensated = await deleteAuthAccount(authUserId)
          .then(() => true)
          .catch(() => false);
        if (!compensated) {
          await writeAuditOutcome({
            entityType: 'auth_account',
            entityId: authUserId,
            actorType: 'system',
            actorId: null,
            action: 'auth.account_orphaned',
          }).catch(() => undefined);
        }
        throw failure;
      }
    },
  },
});
