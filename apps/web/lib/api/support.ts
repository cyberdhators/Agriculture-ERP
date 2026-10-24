import { toIso, type SupportAccountLink, type SupportMessage } from '@agri-erp/shared';

/**
 * "Contact CORWADO" (2026-10-21): the columns staff read and how one row is
 * presented. Never the sender's sign-in id or the connection digest.
 */
export const SUPPORT_COLUMNS = `id, from_kind, name, phone, email, topic, body, status,
        handled_at, created_at`;

export interface SupportRow {
  id: string;
  from_kind: SupportMessage['from_kind'];
  name: string;
  phone: string | null;
  email: string | null;
  topic: SupportMessage['topic'];
  body: string;
  status: SupportMessage['status'];
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

const accountLink = (row: SupportRow): SupportAccountLink | null => {
  if (row.topic !== 'appeal' || !row.appeal_matched_by) return null;
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
  from_kind: row.from_kind,
  name: row.name,
  phone: row.phone,
  email: row.email,
  topic: row.topic,
  body: row.body,
  status: row.status,
  handled_at: row.handled_at ? toIso(row.handled_at) : null,
  created_at: toIso(row.created_at),
  account: accountLink(row),
});
