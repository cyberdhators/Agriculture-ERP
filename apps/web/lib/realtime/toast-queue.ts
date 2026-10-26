/**
 * THE LIVE POP'S QUEUE (2026-10-26) -- pure, so it is tested without a
 * browser. At most POP_MAX cards are shown, newest first; each leaves after
 * POP_LIFETIME_MS unless dismissed sooner. A card carries a `key`: a second
 * card with the same key (the notice about a new conversation AND the
 * message itself, which arrive within a moment of each other) is dropped
 * while the first is still on screen, so one event never pops twice.
 */

import { ACCOUNT_NOTICES, type AccountNotice } from '../farmer-notices';

export const POP_MAX = 3;
export const POP_LIFETIME_MS = 6_000;

export type PopIcon = 'match' | 'message' | 'notice' | 'essential';

export interface Pop {
  id: string;
  /** Same key, same thing: shown once while on screen. */
  key: string;
  icon: PopIcon;
  title: string;
  body: string;
  href: string;
  /** When it arrived (ms). */
  at: number;
}

/** Cards still on screen at `now`. */
export const livePops = (queue: readonly Pop[], now: number): Pop[] =>
  queue.filter((p) => now - p.at < POP_LIFETIME_MS);

/** Adds a card unless one with its key is still showing; keeps the newest POP_MAX. */
export function pushPop(queue: readonly Pop[], pop: Pop, now: number = pop.at): Pop[] {
  const live = livePops(queue, now);
  if (live.some((p) => p.key === pop.key)) return live;
  return [pop, ...live].slice(0, POP_MAX);
}

export const dismissPop = (queue: readonly Pop[], id: string): Pop[] =>
  queue.filter((p) => p.id !== id);

/** The milliseconds until the next card leaves, or null when none is showing. */
export function nextExpiry(queue: readonly Pop[], now: number): number | null {
  const live = livePops(queue, now);
  if (live.length === 0) return null;
  return Math.max(0, Math.min(...live.map((p) => p.at + POP_LIFETIME_MS - now)));
}

/** Which icon a notice gets, from its live kind and fixed name. */
export function popIconFor(kind: string | undefined, notice: string | undefined): PopIcon {
  if (kind === 'promotional' || notice?.startsWith('match_')) return 'match';
  if (notice?.startsWith('message_')) return 'message';
  if (kind === 'essential') return 'essential';
  return 'notice';
}

/**
 * 2026-11-01 (live Scene 1 test): what to do with a notice's live event.
 *
 * - 'skip': the notice is about the conversation the person has open, which
 *   already shows the message (the plain message pop is held back the same
 *   way). The bell still counts it: the shells listen to the event apart.
 * - 'fixed': its name is a fixed notice (ACCOUNT_NOTICES), so the card is
 *   drawn at once from that text in the person's language -- no request
 *   first. The event reached the phone 0.88 s after posting and the card
 *   showed at 2.35 s while it waited for the stored notice.
 * - 'fetch': any other notice (an announcement): its text is read by id.
 */
export type NoticePopPlan =
  { action: 'skip' } | { action: 'fixed'; key: string; title: string } | { action: 'fetch' };

export function planNoticePop(
  event: { notice?: string; ref_kind?: string; ref_id?: string },
  openConversation: string | null,
): NoticePopPlan {
  if (
    event.ref_kind === 'conversation' &&
    event.ref_id &&
    openConversation !== null &&
    event.ref_id === openConversation
  ) {
    return { action: 'skip' };
  }
  const name = event.notice;
  if (name && Object.prototype.hasOwnProperty.call(ACCOUNT_NOTICES, name)) {
    const fixed = ACCOUNT_NOTICES[name as AccountNotice];
    return { action: 'fixed', key: fixed.key, title: fixed.title };
  }
  return { action: 'fetch' };
}
