import {
  CONVERSATIONS_PER_DAY,
  shortName,
  type ChatMessage,
  type ConversationKind,
  type ConversationSummary,
  type PostKind,
} from '@agri-erp/shared';

import { type AuditTx } from './audit';
import { conflict, forbidden, notFound, unprocessable } from './errors';
import { MARKET_BASE_WHERE, MARKET_FROM } from './buyer-presenters';
import {
  BUYING_REQUEST_FROM,
  BUYING_REQUEST_MARKET_WHERE,
  SERVICE_FROM,
  SERVICE_MARKET_WHERE,
} from './market-posts';
import { type Authenticated } from './require-role';

/**
 * IN-APP MESSAGING (2026-10-20). docs/DECISIONS.md, "In-app messaging".
 *
 * WHO TAKES PART. Conversations belong to sign-ins (auth users), not to farmer
 * or buyer records: one account buys and sells (#178), so one inbox holds
 * both. Every read is filtered by the caller's auth user id; a conversation
 * the caller is not part of is 404, never 403, so its existence is not told.
 *
 * STAFF CANNOT READ CHATS. The routes admit farmer and buyer only; there is no
 * staff read path. Problems reach staff through reports.
 *
 * NO TEXT LEAVES THE CONVERSATION. Audit rows carry ids; nothing here writes a
 * notification -- the unread badge is the notice.
 */

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

/** The caller's sign-in. Messaging only ever needs this, never a record id. */
export function me(auth: Authenticated): string {
  if (auth.principal.kind !== 'farmer' && auth.principal.kind !== 'buyer') throw forbidden();
  return auth.principal.authUserId;
}

export const actorOf = (auth: Authenticated) => ({
  actorType: auth.principal.kind as 'farmer' | 'buyer',
  actorId: auth.principal.id,
});

/**
 * How the caller is named to the person they write to: "Mary K.", and for a
 * buyer the organisation they buy for. Never a phone or a full legal name.
 */
export async function myName(db: Db, authUserId: string): Promise<string> {
  const [row] = await db.$queryRawUnsafe<
    { given_name: string; family_name: string; organization: string | null }[]
  >(
    `SELECT given_name, family_name, NULL::text AS organization
       FROM public.farmer_active WHERE auth_user_id = $1::uuid
     UNION ALL
     SELECT b.given_name, b.family_name, o.name
       FROM public.buyer_active b
       JOIN public.buyer_organization_active o ON o.id = b.organization_id
      WHERE b.auth_user_id = $1::uuid
     LIMIT 1`,
    authUserId,
  );
  if (!row) throw forbidden();
  const name = shortName(row.given_name, row.family_name);
  return row.organization ? `${name} · ${row.organization}` : name;
}

/** A post someone can be messaged about: what it is called and who owns it. */
interface PostOwner {
  title: string;
  owner_auth_user_id: string | null;
  owner_name: string;
}

/**
 * Only a post on the market can start a conversation: a draft, a paused or
 * an expired post, or one whose owner was removed, is 404 like a missing one.
 */
const POST_OWNER_SQL: Record<PostKind, string> = {
  listing: `SELECT pl.title, f.auth_user_id AS owner_auth_user_id, pl.trading_name AS owner_name
    ${MARKET_FROM} WHERE pl.id = $1::uuid AND ${MARKET_BASE_WHERE}`,
  buying_request: `SELECT br.product_name AS title,
      COALESCE(f.auth_user_id, b.auth_user_id) AS owner_auth_user_id,
      br.display_name AS owner_name
    ${BUYING_REQUEST_FROM} WHERE br.id = $1::uuid AND ${BUYING_REQUEST_MARKET_WHERE}`,
  // 2026-10-26: a service may be a buyer account's; its owner is that sign-in.
  service: `SELECT sl.title,
      COALESCE(f.auth_user_id, b.auth_user_id) AS owner_auth_user_id,
      sl.trading_name AS owner_name
    ${SERVICE_FROM} WHERE sl.id = $1::uuid AND ${SERVICE_MARKET_WHERE}`,
};

export async function postOwner(db: Db, kind: PostKind, postId: string): Promise<PostOwner> {
  const [row] = await db.$queryRawUnsafe<PostOwner[]>(POST_OWNER_SQL[kind], postId);
  if (!row) throw notFound();
  // A farmer registered by an officer may have no sign-in yet.
  if (!row.owner_auth_user_id) throw unprocessable('conversation_owner_unreachable');
  return row;
}

/**
 * 2026-10-23 (public profiles v2): whether the account has turned in-app
 * messaging off on its profile ("Allow in-app messaging"). No profile is the
 * default, which is on. Only new conversations are refused; one already
 * started goes on, and its owner can close it (block).
 */
export async function refusesMessages(db: Db, authUserId: string): Promise<boolean> {
  const [row] = await db.$queryRawUnsafe<{ allow_messages: boolean }[]>(
    'SELECT allow_messages FROM public.account_profile WHERE auth_user_id = $1::uuid',
    authUserId,
  );
  return row ? !row.allow_messages : false;
}

/** Conversations this account started today (UTC), for the daily brake. */
export async function startedToday(db: Db, authUserId: string): Promise<boolean> {
  const [row] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM public.conversation
      WHERE starter_auth_user_id = $1::uuid AND created_at >= date_trunc('day', now())`,
    authUserId,
  );
  return (row?.n ?? 0) >= CONVERSATIONS_PER_DAY;
}

export interface ConversationRow {
  id: string;
  post_kind: ConversationKind;
  post_id: string;
  post_title: string;
  owner_auth_user_id: string;
  owner_name: string;
  starter_auth_user_id: string;
  starter_name: string;
  last_message_at: Date;
  last_sender_auth_user_id: string | null;
  owner_read_at: Date | null;
  starter_read_at: Date | null;
  blocked_at: Date | null;
  last_body?: string | null;
}

export const CONVERSATION_COLUMNS = `c.id, c.post_kind, c.post_id, c.post_title,
  c.owner_auth_user_id, c.owner_name, c.starter_auth_user_id, c.starter_name,
  c.last_message_at, c.last_sender_auth_user_id, c.owner_read_at, c.starter_read_at,
  c.blocked_at`;

/** The caller's side of a conversation, or 404 if they are not in it. */
export async function loadConversation(
  db: Db,
  id: string,
  authUserId: string,
  lock = false,
): Promise<ConversationRow> {
  const [row] = await db.$queryRawUnsafe<ConversationRow[]>(
    `SELECT ${CONVERSATION_COLUMNS} FROM public.conversation c
      WHERE c.id = $1::uuid AND $2::uuid IN (c.owner_auth_user_id, c.starter_auth_user_id)
      ${lock ? 'FOR UPDATE' : ''}`,
    id,
    authUserId,
  );
  if (!row) throw notFound();
  return row;
}

/** Whether there is anything the reader has not seen. */
export function isUnread(row: ConversationRow, authUserId: string): boolean {
  if (!row.last_sender_auth_user_id || row.last_sender_auth_user_id === authUserId) return false;
  const readAt = row.owner_auth_user_id === authUserId ? row.owner_read_at : row.starter_read_at;
  return readAt === null || readAt < row.last_message_at;
}

/** A preview is a line, never the whole message. */
const preview = (body: string | null | undefined) =>
  body == null ? null : body.length > 80 ? `${body.slice(0, 79)}…` : body;

/** THE ONLY SHAPE A CONVERSATION LEAVES IN. A whitelist, from the reader's side. */
export function presentConversation(row: ConversationRow, authUserId: string): ConversationSummary {
  const iOwn = row.owner_auth_user_id === authUserId;
  return {
    id: row.id,
    post_kind: row.post_kind,
    post_id: row.post_id,
    post_title: row.post_title,
    other_name: iOwn ? row.starter_name : row.owner_name,
    i_own_post: iOwn,
    last_message_at: row.last_message_at.toISOString(),
    last_message_preview: preview(row.last_body),
    last_from_me: row.last_sender_auth_user_id === authUserId,
    unread: isUnread(row, authUserId),
    blocked: row.blocked_at !== null,
  };
}

export const presentMessage = (
  row: { id: string; body: string; sender_auth_user_id: string; created_at: Date },
  authUserId: string,
): ChatMessage => ({
  id: row.id,
  body: row.body,
  from_me: row.sender_auth_user_id === authUserId,
  created_at: row.created_at.toISOString(),
});

/**
 * Stores one message, idempotent on its phone-made id: the same id with the
 * same text in the same conversation is the earlier send, returned as it was;
 * the same id with anything else is a conflict. Moves the conversation on.
 */
export async function insertMessage(
  tx: Db,
  input: { id: string; conversationId: string; sender: string; body: string },
): Promise<{
  row: { id: string; body: string; sender_auth_user_id: string; created_at: Date };
  fresh: boolean;
}> {
  const [inserted] = await tx.$queryRawUnsafe<
    { id: string; body: string; sender_auth_user_id: string; created_at: Date }[]
  >(
    `INSERT INTO public.message (id, conversation_id, sender_auth_user_id, body)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, body, sender_auth_user_id, created_at`,
    input.id,
    input.conversationId,
    input.sender,
    input.body,
  );
  if (inserted) {
    await tx.$queryRawUnsafe(
      `UPDATE public.conversation
          SET last_message_at = $2, last_sender_auth_user_id = $3::uuid,
              owner_read_at = CASE WHEN owner_auth_user_id = $3::uuid THEN $2 ELSE owner_read_at END,
              starter_read_at = CASE WHEN starter_auth_user_id = $3::uuid THEN $2 ELSE starter_read_at END
        WHERE id = $1::uuid`,
      input.conversationId,
      inserted.created_at,
      input.sender,
    );
    return { row: inserted, fresh: true };
  }
  const [earlier] = await tx.$queryRawUnsafe<
    {
      id: string;
      body: string;
      sender_auth_user_id: string;
      conversation_id: string;
      created_at: Date;
    }[]
  >(
    `SELECT id, body, sender_auth_user_id, conversation_id, created_at
       FROM public.message WHERE id = $1::uuid`,
    input.id,
  );
  if (
    !earlier ||
    earlier.conversation_id !== input.conversationId ||
    earlier.sender_auth_user_id !== input.sender ||
    earlier.body !== input.body
  ) {
    throw conflict('message_already_exists');
  }
  return { row: earlier, fresh: false };
}
