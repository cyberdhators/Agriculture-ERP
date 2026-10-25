import {
  type StaffInvitationView,
  maskInviteEmail,
  staffInvitationStatus,
  toIso,
} from '@agri-erp/shared';
import { createHash, randomBytes } from 'node:crypto';

import { mailerConfig, mailerIsConfigured, sendOneEmail } from '../email/resend';

/**
 * STAFF INVITATIONS (2026-10-28, lane-security). docs/DECISIONS.md, "Staff
 * are invited by email and choose their own password".
 *
 * The token is 32 random bytes (base64url, 43 characters). Only its SHA-256
 * hash is stored; the token itself exists in the email, in the one answer to
 * the create call (so the inviter can pass it on if the email did not go), and
 * in the invitee's browser. The link carries it after `#`, so it is never
 * sent to a server in a URL and never lands in an access log.
 */

export const newStaffInvitationToken = (): string => randomBytes(32).toString('base64url');

export const hashStaffInvitationToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const staffInvitationLink = (request: Request, token: string): string =>
  `${new URL(request.url).origin}/staff-invite#${token}`;

export interface StaffInvitationRow {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'supervisor' | 'read_only';
  scope_state_id: string | null;
  invited_by_name: string | null;
  created_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

export const STAFF_INVITATION_SELECT = `SELECT i.id, i.email, i.name, i.role::text AS role,
    i.scope_state_id, u.name AS invited_by_name, i.created_at, i.expires_at, i.accepted_at,
    i.revoked_at
  FROM public.staff_invitation i
  LEFT JOIN public."user" u ON u.id = i.invited_by`;

export const presentStaffInvitation = (
  row: StaffInvitationRow,
  nowMs = Date.now(),
): StaffInvitationView => ({
  id: row.id,
  name: row.name,
  email_hint: maskInviteEmail(row.email),
  role: row.role,
  state_id: row.scope_state_id,
  status: staffInvitationStatus(row, nowMs),
  invited_by_name: row.invited_by_name,
  created_at: toIso(row.created_at),
  expires_at: toIso(row.expires_at),
  accepted_at: row.accepted_at ? toIso(row.accepted_at) : null,
  revoked_at: row.revoked_at ? toIso(row.revoked_at) : null,
});

const ROLE_WORDS: Record<StaffInvitationRow['role'], string> = {
  admin: 'an administrator',
  supervisor: 'a supervisor',
  read_only: 'a read-only member of staff',
};

/**
 * Sends the invitation email. A failure never undoes the invitation: the
 * inviter is given the link and can pass it on another way. Returns whether
 * the provider accepted the message. Never logs the address or the link.
 */
export async function sendStaffInvitationEmail(input: {
  email: string;
  name: string;
  role: StaffInvitationRow['role'];
  inviterName: string;
  link: string;
}): Promise<boolean> {
  if (!mailerIsConfigured()) return false;
  try {
    const sent = await sendOneEmail(
      mailerConfig(),
      input.email,
      'You are invited to join AgriOne staff',
      [
        `Hello ${input.name},`,
        '',
        `${input.inviterName} has invited you to join AgriOne (CORWADO) as ${ROLE_WORDS[input.role]}.`,
        '',
        `Open this link to choose your password and finish setting up your account:`,
        input.link,
        '',
        'The link works once and expires in 7 days. If you did not expect this email, ignore it: no account is created unless you open the link.',
        '',
        'Administrators are asked to set up two-step sign-in with an authenticator app after signing in for the first time.',
      ].join('\n'),
    );
    return sent.accepted;
  } catch {
    return false;
  }
}
