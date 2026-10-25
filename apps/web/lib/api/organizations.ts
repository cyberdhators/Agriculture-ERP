import { createHash, randomBytes } from 'node:crypto';

import {
  ACTING_ORG_COOKIE,
  FARMER_AUTH_DOMAIN,
  invitationState,
  memberMay,
  type InvitationSummary,
  type MemberLike,
  type MyOrganization,
  type OrganizationSummary,
  type OrgPermission,
  type OrgPreset,
  type TeamMember,
} from '@agri-erp/shared';

import { mailerConfig, mailerIsConfigured, sendOneEmail } from '../email/resend';
import { sendOneSms, smsConfig, smsIsConfigured } from '../sms/bird';
import { adminAuthEmails } from '../supabase/admin';
import { writeAudit, type AuditTx } from './audit';
import { forbidden, notFound, unprocessable } from './errors';
import { type Authenticated } from './require-role';

/**
 * TEAM ACCESS, THE SERVER SIDE (2026-10-27). docs/DECISIONS.md,
 * "Organisational profiles and team access".
 *
 * Who may do what is decided by the pure functions in packages/shared
 * (organization.ts); this file loads the rows they judge. Every organisation
 * read is keyed by the caller's sign-in: someone who is not a member gets 404,
 * never 403, so an organisation's team and inbox are not confirmed to exist.
 *
 * ACTING AS. The organisation a person acts for is named by a cookie, and the
 * cookie is a REQUEST, not a grant: `actingAs` re-checks the membership on
 * every call, so access revoked a second ago is refused on the next request.
 */

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

/** The caller's sign-in. Team access is for farmer and buyer accounts only. */
export function personOf(auth: Authenticated): string {
  if (auth.principal.kind !== 'farmer' && auth.principal.kind !== 'buyer') throw forbidden();
  return auth.principal.authUserId;
}

/** The person acting, for the audit row. Always the person, never the organisation. */
export const actorFor = (auth: Authenticated) => ({
  actorType: auth.principal.kind as 'farmer' | 'buyer',
  actorId: auth.principal.id,
});

// ---------------------------------------------------------------------------
// ROWS
// ---------------------------------------------------------------------------

export interface OrganizationRow {
  id: string;
  name: string;
  profile_kind: OrganizationSummary['profile_kind'];
  group_kind: string | null;
  activities: string[];
  about: string | null;
  state_id: string | null;
  location: string | null;
  public_phone: string | null;
  public_email: string | null;
  show_team: boolean;
  status: 'draft' | 'published';
  closed_at: Date | null;
  created_at: Date;
}

export const ORGANIZATION_COLUMNS = `o.id, o.name, o.profile_kind, o.group_kind, o.activities,
  o.about, o.state_id, o.location, o.public_phone, o.public_email, o.show_team, o.status,
  o.closed_at, o.created_at`;

export interface MemberRow {
  id: string;
  organization_id: string;
  auth_user_id: string;
  preset: OrgPreset;
  permissions: OrgPermission[];
  status: 'active' | 'revoked' | 'left';
  show_on_profile: boolean;
  public_title: string | null;
  joined_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
  name?: string | null;
}

const MEMBER_COLUMNS = `m.id, m.organization_id, m.auth_user_id, m.preset, m.permissions,
  m.status, m.show_on_profile, m.public_title, m.joined_at, m.ended_at, m.end_reason`;

/** The person's name as other members see it: "Mary K.". Never a phone. */
const SHORT = (t: string) => `trim(${t}.given_name) || CASE WHEN trim(${t}.family_name) = ''
  THEN '' ELSE ' ' || upper(left(trim(${t}.family_name), 1)) || '.' END`;
export const PERSON_NAME_SQL = (authColumn: string) => `COALESCE(
  (SELECT ${SHORT('f')} FROM public.farmer_active f WHERE f.auth_user_id = ${authColumn} LIMIT 1),
  (SELECT ${SHORT('b')} FROM public.buyer_active b WHERE b.auth_user_id = ${authColumn} LIMIT 1),
  'Former member')`;

export const asMember = (row: MemberRow): MemberLike => ({
  id: row.id,
  preset: row.preset,
  permissions: row.permissions,
  status: row.status,
});

/** An organisation that exists (closed or open), or 404. */
export async function loadOrganization(db: Db, id: string, lock = false): Promise<OrganizationRow> {
  const [row] = await db.$queryRawUnsafe<OrganizationRow[]>(
    `SELECT ${ORGANIZATION_COLUMNS} FROM public.organization o
      WHERE o.id = $1::uuid AND o.deleted_at IS NULL ${lock ? 'FOR UPDATE' : ''}`,
    id,
  );
  if (!row) throw notFound();
  return row;
}

/** Every member row of an organisation, ended ones too, with names. */
export async function loadMembers(db: Db, organizationId: string): Promise<MemberRow[]> {
  return db.$queryRawUnsafe<MemberRow[]>(
    `SELECT ${MEMBER_COLUMNS}, ${PERSON_NAME_SQL('m.auth_user_id')} AS name
       FROM public.organization_member m
      WHERE m.organization_id = $1::uuid
      ORDER BY (m.status = 'active') DESC, m.joined_at, m.id`,
    organizationId,
  );
}

/** The caller's ACTIVE membership of an organisation, or null. */
export async function activeMembership(
  db: Db,
  organizationId: string,
  authUserId: string,
  lock = false,
): Promise<MemberRow | null> {
  const [row] = await db.$queryRawUnsafe<MemberRow[]>(
    `SELECT ${MEMBER_COLUMNS} FROM public.organization_member m
      WHERE m.organization_id = $1::uuid AND m.auth_user_id = $2::uuid AND m.status = 'active'
      ${lock ? 'FOR UPDATE' : ''}`,
    organizationId,
    authUserId,
  );
  return row ?? null;
}

/**
 * The organisation and the caller's membership, or 404 when they are not a
 * member. With `permission`, 403 unless the membership carries it. With
 * `open`, a closed organisation is refused (organization_closed).
 */
export async function requireMember(
  db: Db,
  organizationId: string,
  authUserId: string,
  options: { permission?: OrgPermission; open?: boolean; lock?: boolean } = {},
): Promise<{ organization: OrganizationRow; member: MemberRow }> {
  const organization = await loadOrganization(db, organizationId, options.lock);
  const member = await activeMembership(db, organizationId, authUserId, options.lock);
  if (!member) throw notFound();
  if (options.permission && !memberMay(asMember(member), options.permission)) throw forbidden();
  if (options.open && organization.closed_at) throw unprocessable('organization_closed');
  return { organization, member };
}

/**
 * Takes a transaction-scoped lock on one organisation's team, so two changes
 * to its administrators (two revocations of the last two, a handover and a
 * leave) queue rather than each seeing a world the other is about to change.
 */
export async function lockTeam(db: Db, organizationId: string): Promise<void> {
  await db.$queryRawUnsafe(
    `SELECT 1 AS locked
       FROM (SELECT pg_advisory_xact_lock(hashtext('agri-erp.organization.' || $1::text))) l`,
    organizationId,
  );
}

// ---------------------------------------------------------------------------
// PRESENTERS -- whitelists
// ---------------------------------------------------------------------------

export const presentOrganization = (row: OrganizationRow): OrganizationSummary => ({
  id: row.id,
  name: row.name,
  profile_kind: row.profile_kind,
  group_kind: row.group_kind,
  activities: row.activities,
  about: row.about,
  state_id: row.state_id,
  location: row.location,
  public_phone: row.public_phone,
  public_email: row.public_email,
  show_team: row.show_team,
  status: row.status,
  closed: row.closed_at !== null,
  created_at: row.created_at.toISOString(),
});

export const presentMine = (row: OrganizationRow, member: MemberRow): MyOrganization => ({
  ...presentOrganization(row),
  member_id: member.id,
  preset: member.preset,
  permissions: member.permissions,
  show_on_profile: member.show_on_profile,
  public_title: member.public_title,
});

export const presentMember = (row: MemberRow, me: string): TeamMember => ({
  id: row.id,
  name: row.name ?? 'Former member',
  preset: row.preset,
  permissions: row.permissions,
  status: row.status,
  is_me: row.auth_user_id === me,
  show_on_profile: row.show_on_profile,
  public_title: row.public_title,
  joined_at: row.joined_at.toISOString(),
  ended_at: row.ended_at ? row.ended_at.toISOString() : null,
  end_reason: row.end_reason,
});

export interface InvitationRow {
  id: string;
  organization_id: string;
  organization_name: string;
  kind: 'member' | 'transfer';
  channel: 'phone' | 'email' | null;
  target: string | null;
  target_member_id: string | null;
  target_member_auth_user_id: string | null;
  preset: OrgPreset;
  permissions: OrgPermission[];
  sender_after: InvitationSummary['sender_after'];
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  delivery: string;
  expires_at: Date;
  created_at: Date;
  invited_by_member_id: string;
}

export const INVITATION_SELECT = `SELECT i.id, i.organization_id, o.name AS organization_name,
    i.kind, i.channel, i.target, i.target_member_id, tm.auth_user_id AS target_member_auth_user_id,
    i.preset, i.permissions, i.sender_after, i.status, i.delivery, i.expires_at, i.created_at,
    i.invited_by_member_id
   FROM public.organization_invitation i
   JOIN public.organization o ON o.id = i.organization_id AND o.deleted_at IS NULL
   LEFT JOIN public.organization_member tm ON tm.id = i.target_member_id`;

/**
 * `forTeam`: the organisation's administrators see where it was sent. The
 * recipient's own list never repeats their contact back.
 */
export const presentInvitation = (
  row: InvitationRow,
  now: Date,
  forTeam: boolean,
): InvitationSummary => ({
  id: row.id,
  organization_id: row.organization_id,
  organization_name: row.organization_name,
  kind: row.kind,
  channel: row.channel,
  target: forTeam ? row.target : null,
  target_member_id: row.target_member_id,
  preset: row.preset,
  permissions: row.permissions,
  sender_after: row.sender_after,
  state: invitationState({ status: row.status, expiresAt: row.expires_at }, now),
  delivery: row.delivery,
  expires_at: row.expires_at.toISOString(),
  created_at: row.created_at.toISOString(),
});

// ---------------------------------------------------------------------------
// WHO THE CALLER SIGNED IN AS
// ---------------------------------------------------------------------------

/**
 * The caller's VERIFIED contacts: the phone of their farmer sign-in, and the
 * email of their sign-in when it is a real address (a farmer's sign-in email
 * is derived from the phone and is not one). Only these can accept an
 * invitation, so the recipient is authenticated, not merely holding a link.
 */
export async function callerContacts(
  db: Db,
  authUserId: string,
): Promise<{ authUserId: string; phone: string | null; email: string | null }> {
  const [farmer] = await db.$queryRawUnsafe<{ phone: string }[]>(
    `SELECT phone FROM public.farmer_active WHERE auth_user_id = $1::uuid LIMIT 1`,
    authUserId,
  );
  let email: string | null = null;
  try {
    const found = (await adminAuthEmails([authUserId])).get(authUserId) ?? null;
    if (found && !found.toLowerCase().endsWith(`@${FARMER_AUTH_DOMAIN}`)) {
      email = found.toLowerCase();
    } else if (found && !farmer) {
      // A farmer-domain sign-in with no farmer row: the phone is in the address.
      const digits = /^farmer\.(\d+)@/.exec(found)?.[1];
      if (digits) return { authUserId, phone: `+${digits}`, email: null };
    }
  } catch {
    // Supabase unreachable: the phone, if any, still identifies the caller.
  }
  return { authUserId, phone: farmer?.phone ?? null, email };
}

// ---------------------------------------------------------------------------
// ACTING AS
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The organisation id the request asks to act for, or null. Never trusted alone. */
export function requestedOrganization(request: Request): string | null {
  const cookie = request.headers.get('cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === ACTING_ORG_COOKIE) {
      const value = decodeURIComponent(rest.join('='));
      return UUID.test(value) ? value.toLowerCase() : null;
    }
  }
  return null;
}

export interface Acting {
  organizationId: string;
  name: string;
  member: MemberRow;
}

/**
 * Who the caller is acting for on THIS request: null for themselves, or the
 * organisation the cookie names -- if, and only if, they are an active member
 * of it and it is open. A cookie for an organisation they have lost is
 * refused (organization_access_ended), never silently read as personal: an
 * inquiry answered "as yourself" by mistake is a disclosure.
 */
export async function actingAs(
  db: Db,
  request: Request,
  auth: Authenticated,
): Promise<Acting | null> {
  const acting = await resolveActing(db, request, auth);
  if (acting === 'ended') throw unprocessable('organization_access_ended');
  return acting;
}

/** As actingAs, but says 'ended' instead of refusing: for the route that clears the cookie. */
export async function resolveActing(
  db: Db,
  request: Request,
  auth: Authenticated,
): Promise<Acting | null | 'ended'> {
  const organizationId = requestedOrganization(request);
  if (!organizationId) return null;
  const person = personOf(auth);
  const [row] = await db.$queryRawUnsafe<(MemberRow & { org_name: string })[]>(
    `SELECT ${MEMBER_COLUMNS}, o.name AS org_name
       FROM public.organization_member m
       JOIN public.organization o ON o.id = m.organization_id
      WHERE m.organization_id = $1::uuid AND m.auth_user_id = $2::uuid AND m.status = 'active'
        AND o.deleted_at IS NULL AND o.closed_at IS NULL`,
    organizationId,
    person,
  );
  if (!row) return 'ended';
  return { organizationId, name: row.org_name, member: row };
}

/** As actingAs, and 403 unless the membership carries `permission`. */
export async function actingWith(
  db: Db,
  request: Request,
  auth: Authenticated,
  permission: OrgPermission,
): Promise<Acting | null> {
  const acting = await actingAs(db, request, auth);
  if (acting && !memberMay(asMember(acting.member), permission)) throw forbidden();
  return acting;
}

/** Set-Cookie for the acting choice. httpOnly: the page never reads it; the server checks it. */
export function actingCookie(organizationId: string | null): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return organizationId
    ? `${ACTING_ORG_COOKIE}=${organizationId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`
    : `${ACTING_ORG_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

// ---------------------------------------------------------------------------
// INVITATION TOKENS AND DELIVERY
// ---------------------------------------------------------------------------

/** 32 random bytes, URL-safe: 43 characters. Shown once; only its hash is kept. */
export const newInvitationToken = (): string => randomBytes(32).toString('base64url');

export const hashInvitationToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const invitationLink = (request: Request, token: string): string =>
  `${new URL(request.url).origin}/invite/${token}`;

/**
 * Sends the invitation link by SMS (Bird) or email (Resend) when that service
 * is configured. Returns what happened, for the invitation's `delivery`; a
 * failure never undoes the invitation -- the inviter still has the link.
 * The text names the organisation and the role, never the inviter's contacts.
 */
export async function deliverInvitation(input: {
  channel: 'phone' | 'email';
  target: string;
  organizationName: string;
  presetLabel: string;
  link: string;
}): Promise<'sms_sent' | 'email_sent' | 'send_failed' | 'link_only'> {
  const text =
    `You are invited to join ${input.organizationName} on AgriOne as ${input.presetLabel}. ` +
    `Sign in with this ${input.channel === 'phone' ? 'phone number' : 'email address'} and open ` +
    `${input.link} to accept. The invitation expires in 7 days.`;
  try {
    if (input.channel === 'phone') {
      if (!smsIsConfigured()) return 'link_only';
      const sent = await sendOneSms(smsConfig(), input.target, text);
      return sent.accepted ? 'sms_sent' : 'send_failed';
    }
    if (!mailerIsConfigured()) return 'link_only';
    const sent = await sendOneEmail(
      mailerConfig(),
      input.target,
      `Invitation to join ${input.organizationName} on AgriOne`,
      text,
    );
    return sent.accepted ? 'email_sent' : 'send_failed';
  } catch {
    return 'send_failed';
  }
}

/** The sign-in of an account that already uses this phone, for an in-app notice. */
export async function accountForPhone(db: Db, phone: string): Promise<string | null> {
  const [row] = await db.$queryRawUnsafe<{ auth_user_id: string }[]>(
    `SELECT auth_user_id FROM public.farmer_active
      WHERE phone = $1 AND auth_user_id IS NOT NULL AND suspended_at IS NULL LIMIT 1`,
    phone,
  );
  return row?.auth_user_id ?? null;
}

// ---------------------------------------------------------------------------
// CLOSING AN ORGANISATION
// ---------------------------------------------------------------------------

/**
 * Closes an organisation inside the caller's transaction: its live posts are
 * withdrawn, its conversations closed (what was said stays), every membership
 * ended with the reason, pending invitations cancelled. Nothing is removed.
 * The audit row records the person and the counts.
 */
export async function closeOrganization(
  tx: AuditTx,
  input: {
    organizationId: string;
    closedBy: string;
    reason: string;
    actor: { actorType: 'farmer' | 'buyer'; actorId: string };
  },
): Promise<void> {
  const count = async (sql: string, ...args: unknown[]) =>
    (await tx.$queryRawUnsafe<{ id: string }[]>(sql, ...args)).length;
  const id = input.organizationId;

  const requests = await count(
    `UPDATE public.buying_request SET status = 'withdrawn', updated_at = now()
      WHERE organization_id = $1::uuid AND deleted_at IS NULL
        AND status IN ('draft', 'active', 'paused') RETURNING id`,
    id,
  );
  const services = await count(
    `UPDATE public.service_listing SET status = 'withdrawn', updated_at = now()
      WHERE organization_id = $1::uuid AND deleted_at IS NULL
        AND status IN ('draft', 'active', 'paused') RETURNING id`,
    id,
  );
  // blocked_by must be one of the two sign-ins on the row: the organisation's side.
  const conversations = await count(
    `UPDATE public.conversation
        SET blocked_at = COALESCE(blocked_at, now()),
            blocked_by = COALESCE(blocked_by,
              CASE WHEN owner_organization_id = $1::uuid THEN owner_auth_user_id
                   ELSE starter_auth_user_id END)
      WHERE (owner_organization_id = $1::uuid OR starter_organization_id = $1::uuid)
      RETURNING id`,
    id,
  );
  const members = await count(
    `UPDATE public.organization_member
        SET status = 'revoked', ended_at = now(), ended_by = $2::uuid,
            end_reason = 'The organisation was closed.', updated_at = now()
      WHERE organization_id = $1::uuid AND status = 'active' RETURNING id`,
    id,
    input.closedBy,
  );
  await tx.$queryRawUnsafe(
    `UPDATE public.organization_invitation SET status = 'cancelled', updated_at = now()
      WHERE organization_id = $1::uuid AND status = 'pending'`,
    id,
  );
  await tx.$queryRawUnsafe(
    `UPDATE public.organization
        SET closed_at = now(), closed_by = $2::uuid, closed_reason = $3,
            status = 'draft', updated_at = now()
      WHERE id = $1::uuid`,
    id,
    input.closedBy,
    input.reason,
  );
  await writeAudit(tx, {
    entityType: 'organization',
    entityId: id,
    ...input.actor,
    action: 'organization.closed',
    before: { closed: false },
    after: {
      closed: true,
      reason: input.reason,
      buying_requests_withdrawn: requests,
      services_withdrawn: services,
      conversations_closed: conversations,
      memberships_ended: members,
    },
  });
}
