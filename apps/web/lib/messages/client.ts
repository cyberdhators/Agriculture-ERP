'use client';

import { useEffect, useState } from 'react';

import type {
  BlockedAccount,
  ChatMessage,
  ConversationSummary,
  MyRatings,
  PostKind,
  ReportRatingInput,
  SubmitRatingInput,
} from '@agri-erp/shared';

import { enqueue, queuedOf, subscribeOutbox } from '@/lib/offline/outbox';
import { offlineNow } from '@/lib/offline/net';

/**
 * IN-APP MESSAGING, THE PHONE'S SIDE (2026-10-20). Farmers and buyers share
 * it: conversations belong to the sign-in, so one inbox serves both.
 *
 * Sending goes through the offline outbox: a message is saved on the phone
 * first and sent when there is signal, with an id made here so a retry is
 * stored once. Reading needs signal.
 */

export const MESSAGE_KIND = 'message';

export class MessagesError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MessagesError';
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
    });
  } catch {
    throw new MessagesError(0, 'The server could not be reached. Check the connection.');
  }
  const body = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new MessagesError(
      response.status,
      body.error?.message ?? `The request failed (${response.status}).`,
    );
  }
  return body.data as T;
}

/** The inbox; with `archived`, the Archived tab (2026-11-03). */
export const listConversations = (archived = false) =>
  call<ConversationSummary[]>(`/api/conversations${archived ? '?archived=1' : ''}`);

export const openConversation = (id: string, after?: string) =>
  call<{ conversation: ConversationSummary; messages: ChatMessage[] }>(
    `/api/conversations/${encodeURIComponent(id)}${after ? `?after=${encodeURIComponent(after)}` : ''}`,
  );

/**
 * 2026-11-03: "Archive for me" -- out of the caller's own list only; a new
 * message brings it back. `false` brings it back now ("Unarchive").
 */
export const archiveConversation = (id: string, archive: boolean) =>
  call<ConversationSummary>(`/api/conversations/${encodeURIComponent(id)}/archive`, {
    method: archive ? 'POST' : 'DELETE',
  });

/** 2026-11-03: the caller's deals to rate, the ratings they received, and their summary. */
export const myRatings = () => call<MyRatings>('/api/ratings');

/** Rate the other side of one completed deal. Needs signal; never queued. */
export const submitRating = (input: SubmitRatingInput) =>
  call<{ id: string }>('/api/ratings', { method: 'POST', body: JSON.stringify(input) });

/** Report a rating the caller received. */
export const reportRating = (id: string, input: ReportRatingInput) =>
  call<{ id: string; reported: true }>(`/api/ratings/${encodeURIComponent(id)}/report`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

/** 2026-10-28: block the other person in this conversation (person level). */
export const blockPerson = (conversationId: string) =>
  call<BlockedAccount>('/api/account/blocks', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId }),
  });

/** The accounts the caller has blocked. */
export const listBlocks = () => call<BlockedAccount[]>('/api/account/blocks');

/** Lift one of the caller's blocks. */
export const unblock = (id: string) =>
  call<{ id: string; unblocked: boolean }>(`/api/account/blocks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

/**
 * The first message about a post. Needs signal: the answer says which
 * conversation it opened, and a refusal (your own post, the daily limit) has
 * to be read now, not later.
 */
export const startConversation = (input: { post_kind: PostKind; post_id: string; body: string }) =>
  call<{ conversation: ConversationSummary; message: ChatMessage }>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ ...input, message_id: crypto.randomUUID() }),
  });

/** A message in an open conversation, through the outbox. */
export async function queueMessage(
  conversationId: string,
  otherName: string,
  body: string,
): Promise<ChatMessage | null> {
  const id = crypto.randomUUID();
  const queued = await enqueue({
    id: `message:${id}`,
    kind: MESSAGE_KIND,
    label: `Message to ${otherName}`,
    method: 'POST',
    path: `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    body: { id, body },
  });
  if (!queued) return null;
  messagesChanged();
  return { id, body, from_me: true, created_at: new Date().toISOString() };
}

/** Messages for one conversation still on this phone, oldest first. */
export async function waitingMessages(conversationId: string): Promise<ChatMessage[]> {
  const path = `/api/conversations/${encodeURIComponent(conversationId)}/messages`;
  const rows = await queuedOf(MESSAGE_KIND);
  return rows
    .filter((r) => r.path === path)
    .map((r) => {
      const b = r.body as { id: string; body: string };
      return {
        id: b.id,
        body: b.body,
        from_me: true,
        created_at: new Date(r.createdAt).toISOString(),
      };
    });
}

export { subscribeOutbox };

/* ── The unread badge ───────────────────────────────────────────────── */

const CHANGED = 'agrione-messages-changed';
const listeners = new Set<(n: number) => void>();
let count = 0;
let timer: ReturnType<typeof setInterval> | null = null;

async function load(): Promise<void> {
  if (offlineNow()) return;
  try {
    count = (await call<{ unread: number }>('/api/conversations/unread')).unread;
    for (const l of listeners) l(count);
  } catch {
    // No answer: keep the last count.
  }
}

const onVisible = () => {
  if (document.visibilityState === 'visible') void load();
};
const onChanged = () => void load();

/** Tell the badges that a conversation was read or written to. */
export function messagesChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED));
}

/** Conversations with something unread, shared by every badge on the screen. */
export function useUnreadMessages(enabled: boolean): number {
  const [n, setN] = useState(count);
  useEffect(() => {
    if (!enabled) return;
    listeners.add(setN);
    if (listeners.size === 1) {
      void load();
      timer = setInterval(() => void load(), 60_000);
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener(CHANGED, onChanged);
    } else {
      setN(count);
    }
    return () => {
      listeners.delete(setN);
      if (listeners.size === 0) {
        if (timer) clearInterval(timer);
        timer = null;
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener(CHANGED, onChanged);
      }
    };
  }, [enabled]);
  return enabled ? n : 0;
}
