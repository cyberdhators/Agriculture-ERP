import {
  caseStatusOf,
  defaultCaseType,
  toIso,
  type CaseEntryKind,
  type CasePriority,
  type CaseType,
  type OwnSupportCase,
  type StoredSupportStatus,
  type SupportAccountLink,
  type SupportCaseEntry,
  type SupportMessage,
} from '@agri-erp/shared';

/**
 * "Contact CORWADO" (2026-10-21): the columns staff read and how one row is
 * presented. Never the sender's sign-in id or the connection digest.
 *
 * 2026-10-28: a message is a SUPPORT CASE (the specification's line 103) --
 * case number, type, priority, the responsible staff member, resolution,
 * last change. The row's alias is `sm`; the assignee's name comes from
 * SUPPORT_ASSIGNEE_JOIN (alias `asg`).
 */
export const SUPPORT_COLUMNS = `sm.id, sm.case_number, sm.case_type, sm.priority,
        sm.assignee_id, asg.name AS assignee_name, sm.resolution_note, sm.updated_at,
        sm.from_kind, sm.name, sm.phone, sm.email, sm.topic, sm.body, sm.status,
        sm.handled_at, sm.created_at`;

export const SUPPORT_ASSIGNEE_JOIN = `LEFT JOIN public."user" asg ON asg.id = sm.assignee_id`;

export interface SupportRow {
  id: string;
  case_number: bigint | number | string;
  case_type: CaseType | null;
  priority: CasePriority;
  assignee_id: string | null;
  assignee_name: string | null;
  resolution_note: string | null;
  updated_at: Date;
  from_kind: SupportMessage['from_kind'];
  name: string;
  phone: string | null;
  email: string | null;
  topic: SupportMessage['topic'];
  body: string;
  status: StoredSupportStatus;
  handled_at: Date | null;
  created_at: Date;
  /** Read by the staff list only (APPEAL_ACCOUNT_JOIN); absent elsewhere. */
  appeal_farmer_id?: string | null;
  appeal_buyer_id?: string | null;
  appeal_buyer_standing?: string | null;
  appeal_suspended?: boolean | null;
  appeal_matched_by?: 'sign_in' | 'phone' | null;
}

/**
 * 2026-10-26 (CORWADO's acceptance test, "review appeal and restore"): the
 * account an APPEAL is about, for the staff list's link to the record where
 * Restore is. The sender's own sign-in when they were signed in; otherwise a
 * visitor's phone, but only when exactly ONE live farmer (or, failing that,
 * one live buyer) carries it -- two records with one phone name nobody, and
 * no link is better than the wrong one. Only for topic 'appeal'. The row's
 * alias is `sm`; the account's columns come out as appeal_*.
 *
 * 2026-10-28: the case page shows the same link for EVERY case whose sender
 * signed in (pass `allTopics`), so staff open the account from any case.
 */
export const APPEAL_ACCOUNT_COLUMNS = `acct.farmer_id AS appeal_farmer_id,
        acct.buyer_id AS appeal_buyer_id, acct.buyer_standing AS appeal_buyer_standing,
        acct.suspended AS appeal_suspended, acct.matched_by AS appeal_matched_by`;

export const APPEAL_ACCOUNT_JOIN = `LEFT JOIN LATERAL (
    SELECT * FROM (
      SELECT f.id AS farmer_id, NULL::uuid AS buyer_id, NULL::text AS buyer_standing,
             (f.suspended_at IS NOT NULL) AS suspended,
             CASE WHEN sm.from_auth_user_id IS NULL THEN 'phone' ELSE 'sign_in' END AS matched_by,
             0 AS pick
        FROM public.farmer f
       WHERE f.deleted_at IS NULL
         AND (f.auth_user_id = sm.from_auth_user_id
              OR (sm.from_auth_user_id IS NULL AND sm.phone IS NOT NULL AND f.phone = sm.phone
                  AND (SELECT count(*) FROM public.farmer f2
                        WHERE f2.deleted_at IS NULL AND f2.phone = sm.phone) = 1))
      UNION ALL
      SELECT NULL::uuid, b.id, o.verification_status::text, (b.suspended_at IS NOT NULL),
             CASE WHEN sm.from_auth_user_id IS NULL THEN 'phone' ELSE 'sign_in' END,
             1
        FROM public.buyer b
        JOIN public.buyer_organization o ON o.id = b.organization_id
       WHERE b.deleted_at IS NULL
         AND (b.auth_user_id = sm.from_auth_user_id
              OR (sm.from_auth_user_id IS NULL AND sm.phone IS NOT NULL AND b.phone = sm.phone
                  AND (SELECT count(*) FROM public.buyer b2
                        WHERE b2.deleted_at IS NULL AND b2.phone = sm.phone) = 1))
    ) found
    ORDER BY pick
    LIMIT 1
  ) acct ON sm.topic = 'appeal'`;

/** Every case: a signed-in sender's own account, or an appeal's matched one. */
export const CASE_ACCOUNT_JOIN = APPEAL_ACCOUNT_JOIN.replace(
  "acct ON sm.topic = 'appeal'",
  "acct ON (sm.topic = 'appeal' OR sm.from_auth_user_id IS NOT NULL)",
);

const accountLink = (row: SupportRow): SupportAccountLink | null => {
  if (!row.appeal_matched_by) return null;
  const common = {
    suspended: row.appeal_suspended === true,
    matched_by: row.appeal_matched_by,
  };
  if (row.appeal_farmer_id) {
    return { kind: 'farmer', id: row.appeal_farmer_id, buyer_standing: null, ...common };
  }
  if (row.appeal_buyer_id) {
    return {
      kind: 'buyer',
      id: row.appeal_buyer_id,
      buyer_standing: row.appeal_buyer_standing ?? null,
      ...common,
    };
  }
  return null;
};

export const presentSupport = (row: SupportRow): SupportMessage => ({
  id: row.id,
  case_number: Number(row.case_number),
  case_type: row.case_type ?? defaultCaseType(row.topic),
  priority: row.priority,
  assignee:
    row.assignee_id && row.assignee_name ? { id: row.assignee_id, name: row.assignee_name } : null,
  resolution_note: row.resolution_note,
  updated_at: toIso(row.updated_at),
  from_kind: row.from_kind,
  name: row.name,
  phone: row.phone,
  email: row.email,
  topic: row.topic,
  body: row.body,
  status: caseStatusOf(row.status),
  handled_at: row.handled_at ? toIso(row.handled_at) : null,
  created_at: toIso(row.created_at),
  account: accountLink(row),
});

/** One case by id, with the assignee's name and the account link. */
export const SUPPORT_CASE_SELECT = `SELECT ${SUPPORT_COLUMNS}, ${APPEAL_ACCOUNT_COLUMNS}
   FROM public.support_message sm
   ${SUPPORT_ASSIGNEE_JOIN}
   ${CASE_ACCOUNT_JOIN}
  WHERE sm.id = $1::uuid AND sm.deleted_at IS NULL`;

export interface CaseEntryRow {
  id: string;
  kind: CaseEntryKind;
  body: string;
  link: string | null;
  author_id: string;
  author_name: string | null;
  created_at: Date;
}

export const CASE_ENTRY_SELECT = `SELECT e.id, e.kind, e.body, e.link, e.author_id,
        u.name AS author_name, e.created_at
   FROM public.support_case_entry e
   LEFT JOIN public."user" u ON u.id = e.author_id
  WHERE e.support_message_id = $1::uuid AND e.deleted_at IS NULL
  ORDER BY e.created_at, e.id`;

export const presentEntry = (row: CaseEntryRow): SupportCaseEntry => ({
  id: row.id,
  kind: row.kind,
  body: row.body,
  link: row.link,
  author: { id: row.author_id, name: row.author_name ?? 'Staff member' },
  created_at: toIso(row.created_at),
});

/**
 * Staff who may be made responsible for a case: live staff accounts that hold
 * support.handle -- every administrator (the legacy rule), and anyone with an
 * active platform-wide Support or Super Admin grant. Platform-wide only:
 * support cases carry no state. Ordered by name.
 */
export const ASSIGNABLE_STAFF_SQL = `SELECT u.id, u.name
   FROM public.user_active u
  WHERE u.role = 'admin'
     OR EXISTS (
       SELECT 1 FROM public.staff_permission_grant g
        WHERE g.user_id = u.id AND g.revoked_at IS NULL
          AND g.preset IN ('support', 'super_admin') AND g.scope_kind = 'platform')
  ORDER BY u.name, u.id`;

/** The person's own case: their words, the number, where it stands, staff replies only. */
export interface OwnCaseRow {
  id: string;
  case_number: bigint | number | string;
  topic: OwnSupportCase['topic'];
  status: StoredSupportStatus;
  body: string;
  created_at: Date;
  updated_at: Date;
  replies: { body: string; created_at: string }[] | null;
}

export const presentOwnCase = (row: OwnCaseRow): OwnSupportCase => ({
  id: row.id,
  case_number: Number(row.case_number),
  topic: row.topic,
  status: caseStatusOf(row.status),
  body: row.body,
  created_at: toIso(row.created_at),
  updated_at: toIso(row.updated_at),
  replies: (row.replies ?? []).map((r) => ({
    body: r.body,
    created_at: new Date(r.created_at).toISOString(),
  })),
});
