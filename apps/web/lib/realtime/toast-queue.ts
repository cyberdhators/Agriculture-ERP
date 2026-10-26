/**
 * THE LIVE POP'S QUEUE (2026-10-26) -- pure, so it is tested without a
 * browser. At most POP_MAX cards are shown, newest first; each leaves after
 * POP_LIFETIME_MS unless dismissed sooner. A card carries a `key`: a second
 * card with the same key (the notice about a new conversation AND the
 * message itself, which arrive within a moment of each other) is dropped
 * while the first is still on screen, so one event never pops twice.
 */

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
