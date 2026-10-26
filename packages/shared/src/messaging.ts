import { z } from 'zod';

import { BUYER_MESSAGES } from './buyer';
import type { CounterpartPresence } from './presence';

/**
 * IN-APP MESSAGING (2026-10-20, CORWADO's 16 October specification: "protect
 * private contacts through in-app messaging"). The owner's decision: a
 * conversation is always about a post -- a produce listing, a buying request
 * or a service -- between its owner and one other signed-in account. Nobody
 * can message a person who has posted nothing to answer.
 *
 * A message's id is made on the phone, so a message written with no signal
 * and sent twice is stored once (the offline-sync law).
 */

export const POST_KINDS = ['listing', 'buying_request', 'service'] as const;
export type PostKind = (typeof POST_KINDS)[number];

/**
 * What a conversation can be about: a post, or (2026-10-22) an advice request.
 * Only a post can start one through POST /api/conversations; an advice case's
 * conversation is made with the case, by POST /api/advice/cases, and nowhere else.
 */
export const CONVERSATION_KINDS = [...POST_KINDS, 'advice_case'] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

/** The longest message, in characters. The database checks it too. */
export const MESSAGE_MAX_LENGTH = 2000;

/** New conversations one account may start in a day: the brake on spam. */
export const CONVERSATIONS_PER_DAY = 20;

/** How often an open conversation asks for new messages, in milliseconds. */
export const MESSAGE_POLL_MS = 5000;

// Each pinned in docs/api/CONVENTIONS.md §5.2.3
export const MESSAGING_MESSAGES = {
  postKindUnknown: 'Choose a listing, a buying request or a service.',
  bodyRequired: 'Write a message.',
  bodyTooLong: 'A message has at most 2000 characters.',
  afterInvalid: 'Give the time as an ISO date and time.',
} as const;

const M = MESSAGING_MESSAGES;

const idSchema = z
  .string({ error: () => BUYER_MESSAGES.identifierMalformed })
  .uuid(BUYER_MESSAGES.identifierMalformed);

const bodySchema = z
  .string({ error: () => M.bodyRequired })
  .trim()
  .min(1, M.bodyRequired)
  .max(MESSAGE_MAX_LENGTH, M.bodyTooLong);

/** Starting (or reopening) a conversation about a post, with its first message. */
export const startConversationSchema = z.strictObject({
  post_kind: z.enum(POST_KINDS, { error: () => M.postKindUnknown }),
  post_id: idSchema,
  message_id: idSchema,
  body: bodySchema,
});
export type StartConversationInput = z.infer<typeof startConversationSchema>;

/** One message in a conversation the sender is part of. */
export const sendMessageSchema = z.strictObject({
  id: idSchema,
  body: bodySchema,
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/** A conversation as the inbox shows it, from the reader's side. */
export interface ConversationSummary {
  id: string;
  post_kind: ConversationKind;
  post_id: string;
  post_title: string;
  /** The other person, as they appear on the market. Never a phone. */
  other_name: string;
  /** True when the reader owns the post. */
  i_own_post: boolean;
  last_message_at: string;
  last_message_preview: string | null;
  last_from_me: boolean;
  unread: boolean;
  blocked: boolean;
  /**
   * 2026-10-26: whether the other person has the app open, and when they were
   * last active -- present only when both sides allow it and the other side
   * is one person (never an organisation's team, never staff). presence.ts.
   */
  presence?: CounterpartPresence | null;
}

export interface ChatMessage {
  id: string;
  body: string;
  /** From the reader's side: for an organisation's inbox, a colleague's message is "mine". */
  from_me: boolean;
  created_at: string;
  /**
   * 2026-10-27: in an organisation's shared inbox, the colleague who wrote a
   * message from the organisation's side (null when the reader wrote it).
   * Absent everywhere else, and never shown to the other party.
   */
  sent_by?: string | null;
}

/**
 * How a person is named to the other side: given name and the first letter of
 * the family name ("Mary K."), never the full legal name.
 */
export function shortName(given: string, family: string): string {
  const g = given.trim();
  const f = family.trim();
  return f ? `${g} ${f.charAt(0).toUpperCase()}.` : g;
}

// ---------------------------------------------------------------------------
// PERSON-LEVEL BLOCK (2026-10-28, CORWADO's specification: "Provide report,
// block and support functions"; infographic 7, "Block user").
// ---------------------------------------------------------------------------

/**
 * Block the other person in a conversation the caller is part of. The account
 * to block is never named by the client: it is read from the conversation.
 */
export const blockAccountSchema = z.strictObject({
  conversation_id: idSchema,
});
export type BlockAccountInput = z.infer<typeof blockAccountSchema>;

/** One account the caller has blocked, as the settings list shows it. */
export interface BlockedAccount {
  id: string;
  /** The name the caller saw in the conversation. Never a phone or an id. */
  name: string;
  blocked_at: string;
}
