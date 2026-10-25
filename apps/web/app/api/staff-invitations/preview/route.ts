import {
  type StaffInvitationPreview,
  maskInviteEmail,
  previewStaffInvitationSchema,
  staffInvitationStatus,
  toIso,
} from '@agri-erp/shared';

import { notFound } from '../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { hashStaffInvitationToken } from '../../../../lib/api/staff-invitations';
import { prisma } from '../../../../lib/db';

/**
 * POST /api/staff-invitations/preview { token } -- what an invitee sees before
 * choosing a password (2026-10-28). PUBLIC: they have no account yet. The
 * token is in the body, never in the address. An unknown token is 404, the
 * same as any record that is not there. Shows the name, the role, the masked
 * address and whether the invitation can still be used -- nothing about who
 * else is staff.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: previewStaffInvitationSchema,
    handler: async ({ body }) => {
      const { token } = body as { token: string };
      const [row] = await prisma.$queryRawUnsafe<
        {
          name: string;
          email: string;
          role: StaffInvitationPreview['role'];
          expires_at: Date;
          accepted_at: Date | null;
          revoked_at: Date | null;
        }[]
      >(
        `SELECT name, email, role::text AS role, expires_at, accepted_at, revoked_at
           FROM public.staff_invitation WHERE token_hash = $1`,
        hashStaffInvitationToken(token),
      );
      if (!row) throw notFound();
      const answer: StaffInvitationPreview = {
        name: row.name,
        role: row.role,
        status: staffInvitationStatus(row, Date.now()),
        expires_at: toIso(row.expires_at),
        email_hint: maskInviteEmail(row.email),
      };
      return ok(answer);
    },
  },
});
