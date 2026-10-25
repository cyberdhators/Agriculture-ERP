import {
  CONVERSATIONS_PER_DAY,
  shortName,
  type ChatMessage,
  type ConversationKind,
  type ConversationSummary,
  type OrgPermission,
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
import { actingWith } from './organizations';
import { type Authenticated } from './require-role';

/**
 * IN-APP MESSAGING (2026-10-20). docs/DECISIONS.md, "In-app messaging".
 *
 * WHO TAKES PART. Conversations belong to sign-ins (auth users), not to farmer
 * or buyer records: one account buys and sells (#178), so one inbox holds
 * both. Every read is filtered by the caller's auth user id; a conversation
 * the caller is not part of is 404, never 403, so its existence is not told.
 *
 * 2026-10-27 (team access): A SIDE MAY BE AN ORGANISATION. Each conversation
 * has two sides, owner and starter; either may be an organisation's shared
 * inbox (owner_organization_id / starter_organization_id). The reader is a
 * `Viewer`: a person acting for themselves, who sees only their PERSONAL
 * conversations, or a person acting for an organisation, who sees that
 * organisation's -- with `inbox.read` to read and `inbox.reply` to write,
 * checked on every request. The other party sees the organisation's name;
 * the organisation's members see which colleague wrote; the person who wrote
 * is always in sender_auth_user_id and the audit row.
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

/** Who reads: a person, for themselves (org null) or for an organisation. */
export interface Viewer {
  readonly person: string;
  readonly org: string | null;
  readonly orgName: string | null;
}

/**
 * The reader of this request: themselves, or the organisation they act for
 * when they hold `permission` in it (403 otherwise; a lost membership is
 * organization_access_ended). Never taken from a body.
 */
export async function viewerOf(
  db: Db,
  request: Request,
  auth: Authenticated,
  permission: Extract<OrgPermission, 'inbox.read' | 'inbox.reply'>,
): Promise<Viewer> {
  const person = me(auth);
  const acting = await actingWith(db, request, auth, permission);
  return { person, org: acting?.organizationId ?? null, orgName: acting?.name ?? null };
}

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
  /** 2026-10-27: the organisation the post was made for, whose inbox answers it. */
  owner_organization_id: string | null;
}

/**
 * 2026-10-27: the sign-in that holds the owner's place on a conversation
 * about an organisation's post whose poster has gone: its longest-serving
 * administrator. The conversation itself is the organisation's inbox.
 */
const ORG_ADMIN_SQL = (org: string) => `(SELECT m.auth_user_id FROM public.organization_member m
    WHERE m.organization_id = ${org} AND m.status = 'active' AND m.preset = 'administrator'
    ORDER BY m.joined_at LIMIT 1)`;

/**
 * Only a post on the market can start a conversation: a draft, a paused or
 * an expired post, or one whose owner was removed, is 404 like a missing one.
 */
const POST_OWNER_SQL: Record<PostKind, string> = {
  listing: `SELECT pl.title, f.auth_user_id AS owner_auth_user_id, pl.trading_name AS owner_name,
      NULL::uuid AS owner_organization_id
    ${MARKET_FROM} WHERE pl.id = $1::uuid AND ${MARKET_BASE_WHERE}`,
  buying_request: `SELECT br.product_name AS title,
      COALESCE(f.auth_user_id, b.auth_user_id, ${ORG_ADMIN_SQL('og.id')}) AS owner_auth_user_id,
      br.display_name AS owner_name, br.organization_id AS owner_organization_id
    ${BUYING_REQUEST_FROM} WHERE br.id = $1::uuid AND ${BUYING_REQUEST_MARKET_WHERE}`,
  // 2026-10-26: a service may be a buyer account's; its owner is that sign-in.
  service: `SELECT sl.title,
      COALESCE(f.auth_user_id, b.auth_user_id, ${ORG_ADMIN_SQL('og.id')}) AS owner_auth_user_id,
      sl.trading_name AS owner_name, sl.organization_id AS owner_organization_id
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

export type Side = 'owner' | 'starter';

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
  owner_organization_id: string | null;
  starter_organization_id: string | null;
  last_sender_side: Side | null;
  last_body?: string | null;
}

export const CONVERSATION_COLUMNS = `c.id, c.post_kind, c.post_id, c.post_title,
  c.owner_auth_user_id, c.owner_name, c.starter_auth_user_id, c.starter_name,
  c.last_message_at, c.last_sender_auth_user_id, c.owner_read_at, c.starter_read_at,
  c.blocked_at, c.owner_organization_id, c.starter_organization_id, c.last_sender_side`;

/**
 * THE VIEWER'S CONVERSATIONS, as SQL over alias `c`: for a person acting for
 * themselves, the sides that are theirs and NOT an organisation's (personal
 * messages stay separate); for a person acting for an organisation, that
 * organisation's sides. `person` and `org` are the placeholders to use.
 */
export const viewerWhere = (person: string, org: string) => `(CASE WHEN ${org}::uuid IS NULL
    THEN (c.owner_organization_id IS NULL AND c.owner_auth_user_id = ${person}::uuid)
      OR (c.starter_organization_id IS NULL AND c.starter_auth_user_id = ${person}::uuid)
    ELSE c.owner_organization_id = ${org}::uuid OR c.starter_organization_id = ${org}::uuid END)`;

/** The viewer's side of a conversation they are part of. */
export function sideOf(row: ConversationRow, viewer: Viewer): Side {
  if (viewer.org !== null) return row.owner_organization_id === viewer.org ? 'owner' : 'starter';
  return row.owner_organization_id === null && row.owner_auth_user_id === viewer.person
    ? 'owner'
    : 'starter';
}

/** Which side wrote last. Rows from before 2026-10-27 carry no side: it is read from the sign-in. */
const lastSide = (row: ConversationRow): Side | null =>
  row.last_sender_auth_user_id === null
    ? null
    : (row.last_sender_side ??
      (row.last_sender_auth_user_id === row.owner_auth_user_id ? 'owner' : 'starter'));

/** The viewer's side of a conversation, or 404 if they are not in it. */
export async function loadConversation(
  db: Db,
  id: string,
  viewer: Viewer,
  lock = false,
): Promise<ConversationRow> {
  const [row] = await db.$queryRawUnsafe<ConversationRow[]>(
    `SELECT ${CONVERSATION_COLUMNS} FROM public.conversation c
      WHERE c.id = $1::uuid AND ${viewerWhere('$2', '$3')}
      ${lock ? 'FOR UPDATE' : ''}`,
    id,
    viewer.person,
    viewer.org,
  );
  if (!row) throw notFound();
  return row;
}

/** Whether there is anything the reader's side has not seen. */
export function isUnread(row: ConversationRow, viewer: Viewer): boolean {
  const side = sideOf(row, viewer);
  const last = lastSide(row);
  if (last === null || last === side) return false;
  const readAt = side === 'owner' ? row.owner_read_at : row.starter_read_at;
  return readAt === null || readAt < row.last_message_at;
}

/** A preview is a line, never the whole message. */
const preview = (body: string | null | undefined) =>
  body == null ? null : body.length > 80 ? `${body.slice(0, 79)}…` : body;

/** THE ONLY SHAPE A CONVERSATION LEAVES IN. A whitelist, from the reader's side. */
export function presentConversation(row: ConversationRow, viewer: Viewer): ConversationSummary {
  const side = sideOf(row, viewer);
  return {
    id: row.id,
    post_kind: row.post_kind,
    post_id: row.post_id,
    post_title: row.post_title,
    other_name: side === 'owner' ? row.starter_name : row.owner_name,
    i_own_post: side === 'owner',
    last_message_at: row.last_message_at.toISOString(),
    last_message_preview: preview(row.last_body),
    last_from_me: lastSide(row) === side,
    unread: isUnread(row, viewer),
    blocked: row.blocked_at !== null,
  };
}

export interface MessageRow {
  id: string;
  body: string;
  sender_auth_user_id: string;
  sender_side?: Side | null;
  created_at: Date;
  /** Only read for an organisation's members: the colleague who wrote. */
  sender_name?: string | null;
}

/**
 * One message, from the reader's side. `from_me` is "from my side": for an
 * organisation, a colleague's message is the organisation's. Members of an
 * organisation also see `sent_by`, the colleague's name; the other party
 * never does.
 */
export const presentMessage = (
  row: MessageRow,
  conversation: Pick<ConversationRow, 'owner_auth_user_id' | 'owner_organization_id' | 'starter_organization_id'> &
    Partial<ConversationRow>,
  viewer: Viewer,
): ChatMessage => {
  const side: Side =
    row.sender_side ?? (row.sender_auth_user_id === conversation.owner_auth_user_id ? 'owner' : 'starter');
  const mySide = sideOf(conversation as ConversationRow, viewer);
  const mine = side === mySide;
  return {
    id: row.id,
    body: row.body,
    from_me: mine,
    created_at: row.created_at.toISOString(),
    ...(viewer.org !== null && mine
      ? { sent_by: row.sender_auth_user_id === viewer.person ? null : (row.sender_name ?? null) }
      : {}),
  };
};

/**
 * Stores one message, idempotent on its phone-made id: the same id with the
 * same text in the same conversation is the earlier send, returned as it was;
 * the same id with anything else is a conflict. Moves the conversation on.
 *
 * `side` (2026-10-27) is the sender's side; without it the side is read from
 * the sign-in, which is exact for every personal conversation.
 */
export async function insertMessage(
  tx: Db,
  input: { id: string; conversationId: string; sender: string; body: string; side?: Side },
): Promise<{ row: MessageRow; fresh: boolean }> {
  const [inserted] = await tx.$queryRawUnsafe<MessageRow[]>(
    `INSERT INTO public.message (id, conversation_id, sender_auth_user_id, body, sender_side)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, body, sender_auth_user_id, sender_side, created_at`,
    input.id,
    input.conversationId,
    input.sender,
    input.body,
    input.side ?? null,
  );
  if (inserted) {
    await tx.$queryRawUnsafe(
      `UPDATE public.conversation c
          SET last_message_at = $2, last_sender_auth_user_id = $3::uuid, last_sender_side = s.side,
              owner_read_at = CASE WHEN s.side = 'owner' THEN $2 ELSE owner_read_at END,
              starter_read_at = CASE WHEN s.side = 'starter' THEN $2 ELSE starter_read_at END
         FROM (SELECT COALESCE($4::text,
                 CASE WHEN owner_auth_user_id = $3::uuid THEN 'owner' ELSE 'starter' END) AS side
                 FROM public.conversation WHERE id = $1::uuid) s
        WHERE c.id = $1::uuid`,
      input.conversationId,
      inserted.created_at,
      input.sender,
      input.side ?? null,
    );
    return { row: inserted, fresh: true };
  }
  const [earlier] = await tx.$queryRawUnsafe<(MessageRow & { conversation_id: string })[]>(
    `SELECT id, body, sender_auth_user_id, sender_side, conversation_id, created_at
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
