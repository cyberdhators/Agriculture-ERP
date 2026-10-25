import {
  memberMay,
  orgAdviceMay,
  type OrgAdviceCaller,
  type OrgAdviceCaseState,
  type OrgAdviceCaseView,
  type OrgAdviceHandler,
} from '@agri-erp/shared';

import { CASE_SELECT, type CaseRow } from './advice';
import { type AuditTx } from './audit';
import { notFound } from './errors';
import {
  PERSON_NAME_SQL,
  asMember,
  requireMember,
  type MemberRow,
  type OrganizationRow,
} from './organizations';

/**
 * ORGANISATION ADVICE CASES, THE SERVER SIDE (2026-10-28). docs/DECISIONS.md,
 * "Organisation advice cases". Who may do what is orgAdviceDecision in
 * packages/shared (organization-advice.ts); this file loads what it judges.
 *
 * THE SHARED ADVICE INBOX IS FOR HANDLERS ONLY. Every read starts with
 * `requireHandler`: an ACTIVE membership of the organisation (404 otherwise,
 * so neither the organisation's inbox nor a case in it is confirmed to exist)
 * that carries `advisory.handle` (403 otherwise). It is asked on every
 * request, so a member removed, or whose permission is taken away, is refused
 * on the next one. A case outside the organisation's own profile is 404.
 *
 * Members never see a requester's phone or place unless the requester ticked
 * "share", and then only the member handling the case (or an administrator).
 */

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

export interface Handler {
  organization: OrganizationRow;
  member: MemberRow;
  caller: OrgAdviceCaller;
}

/** The caller as a handler of this organisation's advice, or 404 / 403. */
export async function requireHandler(
  db: Db,
  organizationId: string,
  person: string,
  options: { open?: boolean; lock?: boolean } = {},
): Promise<Handler> {
  const { organization, member } = await requireMember(db, organizationId, person, {
    permission: 'advisory.handle',
    ...options,
  });
  return {
    organization,
    member,
    caller: {
      person,
      handles: memberMay(asMember(member), 'advisory.handle'),
      administrator: member.preset === 'administrator',
    },
  };
}

export interface OrgCaseRow extends CaseRow {
  assignee_member_id: string | null;
  assignee_name: string | null;
}

/** A case of this organisation's profile, with who is handling it. */
const ORG_CASE_SELECT = CASE_SELECT.replace(
  /^SELECT /,
  `SELECT ${PERSON_NAME_SQL('ac.assigned_auth_user_id')} AS assignee_name,
    (SELECT om.id FROM public.organization_member om
      WHERE om.organization_id = p.organization_id
        AND om.auth_user_id = ac.assigned_auth_user_id AND om.status = 'active'
      LIMIT 1) AS assignee_member_id, `,
);

/** The organisation's cases in one status, newest first, at most 200. */
export async function listOrgCases(
  db: Db,
  organizationId: string,
  status: string,
): Promise<OrgCaseRow[]> {
  return db.$queryRawUnsafe<OrgCaseRow[]>(
    `${ORG_CASE_SELECT}
      WHERE p.organization_id = $1::uuid AND ac.deleted_at IS NULL AND ac.status = $2
      ORDER BY ac.created_at DESC, ac.id DESC
      LIMIT 200`,
    organizationId,
    status,
  );
}

/** One case of this organisation's profile, or 404. */
export async function loadOrgCase(
  db: Db,
  organizationId: string,
  caseId: string,
  lock = false,
): Promise<OrgCaseRow> {
  if (lock) {
    // Lock the case row itself first; the read below is a plain select.
    const [locked] = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT ac.id FROM public.advice_case ac
         JOIN public.advice_provider p ON p.id = ac.provider_id
        WHERE ac.id = $1::uuid AND p.organization_id = $2::uuid AND ac.deleted_at IS NULL
        FOR UPDATE OF ac`,
      caseId,
      organizationId,
    );
    if (!locked) throw notFound();
  }
  const [row] = await db.$queryRawUnsafe<OrgCaseRow[]>(
    `${ORG_CASE_SELECT}
      WHERE ac.id = $1::uuid AND p.organization_id = $2::uuid AND ac.deleted_at IS NULL`,
    caseId,
    organizationId,
  );
  if (!row) throw notFound();
  return row;
}

export const caseState = (row: CaseRow): OrgAdviceCaseState => ({
  status: row.status,
  assignee: row.assigned_auth_user_id,
  accepted: row.accepted_at !== null,
});

/** Whether the organisation's side has not seen the requester's latest message. */
function orgUnread(row: CaseRow): boolean {
  if (!row.last_message_at || !row.last_sender_auth_user_id) return false;
  if (row.last_sender_auth_user_id !== row.requester_auth_user_id) return false;
  return row.owner_read_at === null || row.owner_read_at < row.last_message_at;
}

/** THE ONLY SHAPE AN ORGANISATION'S CASE LEAVES IN, to its handlers. A whitelist. */
export function presentOrgCase(row: OrgCaseRow, caller: OrgAdviceCaller): OrgAdviceCaseView {
  return {
    id: row.id,
    provider: { id: row.provider_id, display_name: row.provider_name },
    requester_name: row.requester_name,
    topic: row.topic,
    question: row.question,
    preferred_contact: row.preferred_contact,
    share_details: row.share_details,
    status: row.status,
    outcome: row.outcome,
    assigned_to: row.assigned_auth_user_id
      ? {
          member_id: row.assignee_member_id,
          name: row.assignee_name ?? 'Former member',
          is_me: row.assigned_auth_user_id === caller.person,
        }
      : null,
    accepted: row.accepted_at !== null,
    may: orgAdviceMay(caller, caseState(row)),
    unread: orgUnread(row),
    closed_at: row.closed_at ? row.closed_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * Whether this handler may see what the requester chose to share: the member
 * who accepted the case, or an administrator. Others handling advice see the
 * question, not the person's place or phone.
 */
export const maySeeShared = (row: CaseRow, caller: OrgAdviceCaller): boolean =>
  row.share_details &&
  (caller.administrator ||
    (row.assigned_auth_user_id === caller.person && row.accepted_at !== null));

/** The organisation's members who can be given cases now. Names only, never a phone. */
export async function listHandlers(
  db: Db,
  organizationId: string,
  person: string,
): Promise<OrgAdviceHandler[]> {
  const rows = await db.$queryRawUnsafe<{ id: string; auth_user_id: string; name: string }[]>(
    `SELECT m.id, m.auth_user_id, ${PERSON_NAME_SQL('m.auth_user_id')} AS name
       FROM public.organization_member m
      WHERE m.organization_id = $1::uuid AND m.status = 'active'
        AND (m.preset = 'administrator' OR 'advisory.handle' = ANY (m.permissions))
      ORDER BY m.joined_at, m.id`,
    organizationId,
  );
  return rows.map((r) => ({ member_id: r.id, name: r.name, is_me: r.auth_user_id === person }));
}
