import {
  ADVICE_CASES_PER_DAY,
  type AdviceCaseView,
  type AdviceProviderOwn,
  type AdviceProviderPublic,
} from '@agri-erp/shared';

import { type AuditTx } from './audit';
import { notFound } from './errors';

/**
 * INDEPENDENT ADVICE (2026-10-22), part 1. docs/DECISIONS.md, "Advice: find a
 * provider and ask".
 *
 * WHO TAKES PART. Like messaging, providers and requesters are sign-ins (auth
 * users), never farmer or buyer records: one account buys, sells, asks and
 * advises. Every case read is filtered to its two participants; anyone else
 * gets 404, so a case's existence is not told. Staff have no read path.
 *
 * THE PRIVACY LINE. A provider leaves the API through presentProvider: no
 * phone, no account id. A case's question is shown to its two participants
 * only; the requester's place and phone reach the provider only when the
 * requester ticked "share", and the phone only when they asked to be called
 * or texted. No audit row carries a question, a message or a comment.
 */

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

// ---------------------------------------------------------------------------
// PROVIDERS
// ---------------------------------------------------------------------------

/**
 * A provider's account is live: a farmer or buyer record on it that is
 * neither deleted (the _active views) nor suspended. A deleted or suspended
 * account's profile leaves the directory and takes no new requests, and comes
 * back as it was if the account is restored.
 */
export const PROVIDER_ACCOUNT_LIVE = `(
  EXISTS (SELECT 1 FROM public.farmer_active fa
           WHERE fa.auth_user_id = p.auth_user_id AND fa.suspended_at IS NULL)
  OR EXISTS (SELECT 1 FROM public.buyer_active ba
              WHERE ba.auth_user_id = p.auth_user_id AND ba.suspended_at IS NULL)
)`;

/** What the public directory may show: published, not deleted, account live. */
export const PROVIDER_PUBLIC_WHERE = `p.deleted_at IS NULL AND p.status = 'published'
  AND ${PROVIDER_ACCOUNT_LIVE}`;

export const PROVIDER_COLUMNS = `p.id, p.display_name, p.provider_kind, p.description, p.topics,
  p.languages, p.state_ids, p.delivery_modes, p.availability, p.terms, p.fee_note,
  p.commercial_interests, p.status, p.created_at, p.updated_at, p.approved_at,
  COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
              FROM public.state_active s WHERE s.id = ANY (p.state_ids)), '[]'::json) AS states`;

export interface ProviderRow {
  id: string;
  display_name: string;
  provider_kind: AdviceProviderPublic['provider_kind'];
  description: string;
  topics: AdviceProviderPublic['topics'];
  languages: AdviceProviderPublic['languages'];
  state_ids: string[];
  delivery_modes: AdviceProviderPublic['delivery_modes'];
  availability: string | null;
  terms: AdviceProviderPublic['terms'];
  fee_note: string | null;
  commercial_interests: string | null;
  status: AdviceProviderOwn['status'];
  created_at: Date;
  updated_at: Date;
  /** 2026-10-24: set by an approval, cleared by a revocation. */
  approved_at: Date | null;
  states: { id: string; name: string }[];
}

/** THE ONLY SHAPE A PROVIDER LEAVES IN, to anyone. A whitelist. */
export const presentProvider = (row: ProviderRow): AdviceProviderPublic => ({
  id: row.id,
  display_name: row.display_name,
  provider_kind: row.provider_kind,
  description: row.description,
  topics: row.topics,
  languages: row.languages,
  states: row.states,
  delivery_modes: row.delivery_modes,
  availability: row.availability,
  terms: row.terms,
  fee_note: row.fee_note,
  commercial_interests: row.commercial_interests,
  // The badge, and the month it was given: never the application or its id.
  approved_adviser: row.approved_at !== null,
  approved_since: row.approved_at ? row.approved_at.toISOString().slice(0, 7) : null,
  updated_at: row.updated_at.toISOString(),
});

/** The owner's own profile: the public shape, its status and its state codes. */
export const presentOwnProvider = (row: ProviderRow): AdviceProviderOwn => ({
  ...presentProvider(row),
  status: row.status,
  state_ids: row.state_ids,
  created_at: row.created_at.toISOString(),
});

/** The caller's own profile, or null if they have none. */
export async function loadOwnProvider(
  db: Db,
  authUserId: string,
  lock = false,
): Promise<ProviderRow | null> {
  const [row] = await db.$queryRawUnsafe<ProviderRow[]>(
    `SELECT ${PROVIDER_COLUMNS} FROM public.advice_provider p
      WHERE p.auth_user_id = $1::uuid AND p.deleted_at IS NULL
      ${lock ? 'FOR UPDATE OF p' : ''}`,
    authUserId,
  );
  return row ?? null;
}

// ---------------------------------------------------------------------------
// CASES
// ---------------------------------------------------------------------------

/** New requests this account sent today (UTC), for the daily brake. */
export async function casesToday(db: Db, authUserId: string): Promise<boolean> {
  const [row] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM public.advice_case
      WHERE requester_auth_user_id = $1::uuid AND created_at >= date_trunc('day', now())`,
    authUserId,
  );
  return (row?.n ?? 0) >= ADVICE_CASES_PER_DAY;
}

export interface CaseRow {
  id: string;
  provider_id: string;
  provider_name: string;
  provider_auth_user_id: string;
  requester_auth_user_id: string;
  requester_name: string;
  topic: AdviceCaseView['topic'];
  question: string;
  preferred_contact: AdviceCaseView['preferred_contact'];
  share_details: boolean;
  status: AdviceCaseView['status'];
  outcome: AdviceCaseView['outcome'];
  closed_at: Date | null;
  closed_by: string | null;
  feedback_rating: number | null;
  feedback_comment: string | null;
  created_at: Date;
  updated_at: Date;
  conversation_id: string | null;
  last_message_at: Date | null;
  last_sender_auth_user_id: string | null;
  owner_read_at: Date | null;
  starter_read_at: Date | null;
}

/** A case with its provider and its conversation, for its two participants only. */
export const CASE_SELECT = `SELECT ac.id, ac.provider_id, p.display_name AS provider_name,
    p.auth_user_id AS provider_auth_user_id, ac.requester_auth_user_id, ac.requester_name,
    ac.topic, ac.question, ac.preferred_contact, ac.share_details, ac.status, ac.outcome,
    ac.closed_at, ac.closed_by, ac.feedback_rating, ac.feedback_comment, ac.created_at,
    ac.updated_at, c.id AS conversation_id, c.last_message_at, c.last_sender_auth_user_id,
    c.owner_read_at, c.starter_read_at
  FROM public.advice_case ac
  JOIN public.advice_provider p ON p.id = ac.provider_id
  LEFT JOIN public.conversation c ON c.post_kind = 'advice_case' AND c.post_id = ac.id`;

/** The caller's side of a case, or 404 if they are not one of its two people. */
export async function loadCase(
  db: Db,
  id: string,
  authUserId: string,
  lock = false,
): Promise<CaseRow> {
  const [row] = await db.$queryRawUnsafe<CaseRow[]>(
    `${CASE_SELECT}
      WHERE ac.id = $1::uuid AND ac.deleted_at IS NULL
        AND $2::uuid IN (ac.requester_auth_user_id, p.auth_user_id)
      ${lock ? 'FOR UPDATE OF ac' : ''}`,
    id,
    authUserId,
  );
  if (!row) throw notFound();
  return row;
}

export const sideOf = (row: CaseRow, authUserId: string): 'requester' | 'provider' =>
  row.requester_auth_user_id === authUserId ? 'requester' : 'provider';

/**
 * What the requester chose to share, for the provider's eyes: their general
 * place (payam and state for a farmer, the organisation's state for a buyer),
 * and their phone only when they asked to be called or texted. Read when the
 * provider opens the case, so it is current, and never stored on the case.
 */
async function sharedDetails(
  db: Db,
  row: CaseRow,
): Promise<{ place: string | null; phone: string | null }> {
  const [found] = await db.$queryRawUnsafe<{ place: string | null; phone: string | null }[]>(
    `SELECT concat_ws(', ', pm.name, s.name) AS place, fa.phone
       FROM public.farmer_active fa
       LEFT JOIN public.payam pm ON pm.id = fa.payam_id
       LEFT JOIN public.state s ON s.id = fa.state_id
      WHERE fa.auth_user_id = $1::uuid
     UNION ALL
     SELECT s.name AS place, ba.phone
       FROM public.buyer_active ba
       JOIN public.buyer_organization_active o ON o.id = ba.organization_id
       LEFT JOIN public.state s ON s.id = o.state_id
      WHERE ba.auth_user_id = $1::uuid
     LIMIT 1`,
    row.requester_auth_user_id,
  );
  return {
    place: found?.place || null,
    phone: row.preferred_contact === 'in_app' ? null : (found?.phone ?? null),
  };
}

/** Whether the conversation holds a message this reader has not seen. */
function unread(row: CaseRow, authUserId: string): boolean {
  if (!row.last_message_at || !row.last_sender_auth_user_id) return false;
  if (row.last_sender_auth_user_id === authUserId) return false;
  // The provider owns the case's conversation; the requester started it.
  const readAt = sideOf(row, authUserId) === 'provider' ? row.owner_read_at : row.starter_read_at;
  return readAt === null || readAt < row.last_message_at;
}

/**
 * THE ONLY SHAPE A CASE LEAVES IN, from the reader's side. `withShared` reads
 * the requester's shared details for the provider; lists leave it off.
 */
export async function presentCase(
  db: Db,
  row: CaseRow,
  authUserId: string,
  withShared = false,
): Promise<AdviceCaseView> {
  const side = sideOf(row, authUserId);
  return {
    id: row.id,
    my_side: side,
    provider: { id: row.provider_id, display_name: row.provider_name },
    requester_name: row.requester_name,
    topic: row.topic,
    question: row.question,
    preferred_contact: row.preferred_contact,
    share_details: row.share_details,
    shared:
      side === 'provider' && row.share_details && withShared ? await sharedDetails(db, row) : null,
    status: row.status,
    outcome: row.outcome,
    closed_at: row.closed_at ? row.closed_at.toISOString() : null,
    closed_by_me: row.closed_by === authUserId,
    feedback_rating: row.feedback_rating,
    feedback_comment: row.feedback_comment,
    conversation_id: row.conversation_id,
    unread: unread(row, authUserId),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
