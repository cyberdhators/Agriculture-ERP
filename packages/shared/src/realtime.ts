import { z } from 'zod';

import { memberMay, type MemberLike } from './organization';

/**
 * LIVE UPDATES OVER BIRD REALTIME (2026-10-26). docs/DECISIONS.md, "Bird
 * Realtime live updates".
 *
 * WHAT TRAVELS IS A NUDGE, NEVER CONTENT. An event says "something of this
 * kind, with this id, changed for you"; the screen then asks the API for it,
 * through the same routes and the same checks as before. No message text, no
 * notice wording, no name, no phone ever goes through Bird. So a payload is
 * built only from the field names below, every value an id or a fixed word.
 *
 * CHANNELS. Every channel is private (`private-`, authorized per subscription
 * by POST /api/realtime/auth) or presence (`presence-`, likewise):
 *
 *   private-acct-<auth user uuid>  one account's notices and personal chats.
 *                                  Only that account may subscribe.
 *   private-org-<organisation uuid> an organisation's shared inbox. Active
 *                                  members holding inbox.read (administrators
 *                                  hold every permission).
 *   presence-acct-<auth user uuid> "this account has the app open". Only that
 *                                  account may join, and only while its "show
 *                                  when I'm active" switch is on. Nobody else
 *                                  subscribes: the server asks Bird which of
 *                                  these channels are occupied, and applies
 *                                  the visibility rules (presence.ts) itself.
 *
 * EVENTS. `notification.created` (a notice was stored for the account) and
 * `message.created` (a conversation the channel can read has a new message).
 * The notice's `kind` already allows `promotional`, so marketing notices can
 * be added without any change to channel authorization.
 */

export const REALTIME_EVENTS = ['notification.created', 'message.created'] as const;
export type RealtimeEventName = (typeof REALTIME_EVENTS)[number];

/** How a notice is classed. `promotional` is for marketing (match alerts). */
export const LIVE_NOTICE_KINDS = ['essential', 'update', 'announcement', 'promotional'] as const;
export type LiveNoticeKind = (typeof LIVE_NOTICE_KINDS)[number];

/**
 * What a notice points at, when it points at one post or conversation --
 * or (2026-11-03) a rating the account received, which opens the Ratings tab.
 */
export const NOTICE_REF_KINDS = ['buying_request', 'listing', 'conversation', 'rating'] as const;
export type NoticeRefKind = (typeof NOTICE_REF_KINDS)[number];

export interface NotificationCreatedPayload {
  /** The stored notification's id; the screen reads its text from the API. */
  notification_id: string;
  kind: LiveNoticeKind;
  /** The fixed notice name (lib/farmer-notices.ts ACCOUNT_NOTICES), or 'announcement'. */
  notice: string;
  ref_kind?: NoticeRefKind;
  ref_id?: string;
}

export interface MessageCreatedPayload {
  conversation_id: string;
  /** The message's id, so a screen that already shows it does nothing. */
  message_id: string;
  /** The sign-in that wrote it, so the writer's own screens do not pop. */
  sender: string;
}

export type RealtimePayload = NotificationCreatedPayload | MessageCreatedPayload;

/**
 * Every field name a payload may carry. tests/realtime-payload-scan.test.ts
 * holds the publishing code to this list, so a `body`, `title` or `text`
 * cannot be added to an event by accident.
 */
export const REALTIME_PAYLOAD_FIELDS = [
  'notification_id',
  'kind',
  'notice',
  'ref_kind',
  'ref_id',
  'conversation_id',
  'message_id',
  'sender',
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const accountChannel = (authUserId: string) => `private-acct-${authUserId}`;
export const organizationChannel = (organizationId: string) => `private-org-${organizationId}`;
export const presenceChannel = (authUserId: string) => `presence-acct-${authUserId}`;
export const PRESENCE_PREFIX = 'presence-acct-';

export type ParsedChannel =
  | { kind: 'account'; id: string }
  | { kind: 'organization'; id: string }
  | { kind: 'presence'; id: string };

/** A channel name this application uses, or null for anything else. */
export function parseChannel(name: string): ParsedChannel | null {
  const m = /^(private-acct|private-org|presence-acct)-(.+)$/.exec(name);
  if (!m) return null;
  const id = m[2] as string;
  if (!UUID.test(id)) return null;
  if (m[1] === 'private-acct') return { kind: 'account', id };
  if (m[1] === 'private-org') return { kind: 'organization', id };
  return { kind: 'presence', id };
}

/** What the server knows about the person asking to subscribe. */
export interface ChannelAuthFacts {
  /** The session's sign-in; null when there is no farmer or buyer session. */
  authUserId: string | null;
  /** Their memberships, by organisation id. */
  memberships: ReadonlyMap<string, MemberLike>;
  /** Their "show when I'm active" switch. */
  showActivity: boolean;
}

/**
 * THE CHANNEL RULE. Pure, and the only decision the authorization route
 * makes: own account channel; an organisation inbox with inbox.read; own
 * presence only while showing activity. Anything else, or no session, no.
 */
export function mayJoinChannel(name: string, facts: ChannelAuthFacts): boolean {
  if (!facts.authUserId) return false;
  const channel = parseChannel(name);
  if (!channel) return false;
  if (channel.kind === 'account') return channel.id === facts.authUserId;
  if (channel.kind === 'presence') return channel.id === facts.authUserId && facts.showActivity;
  return memberMay(facts.memberships.get(channel.id), 'inbox.read');
}

/** POST /api/realtime/auth -- what the browser client sends (Bird's contract). */
export const realtimeAuthSchema = z.strictObject({
  connection_id: z.string().trim().min(1).max(200),
  channel_name: z.string().trim().min(1).max(200),
});
export type RealtimeAuthInput = z.infer<typeof realtimeAuthSchema>;

/** GET /api/realtime/channels -- what the screen should subscribe to. */
export interface RealtimeChannels {
  /** False when the deployment has no Realtime app configured: poll as before. */
  enabled: boolean;
  /** The caller's sign-in, so the screen can ignore its own messages. */
  me: string | null;
  channels: string[];
}
