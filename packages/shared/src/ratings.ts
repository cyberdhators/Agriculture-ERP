import { z } from 'zod';

import { BUYER_MESSAGES } from './buyer';
import { REPORT_REASONS, type ReportReason } from './product-reports';

/**
 * RATINGS AFTER A COMPLETED DEAL (2026-11-03, the owner's approval of the
 * lane-trust brief). docs/DECISIONS.md, "Ratings after a completed deal".
 *
 * WHAT A DEAL IS. The application records two kinds of completed trade, and
 * only these are rated:
 *
 *   purchase_order  a buyer organisation's order for a farmer's produce,
 *                   moved to `completed` by staff. The two sides are the buyer
 *                   (a live buyer account of the ordering organisation) and
 *                   the seller (the farmer the order names).
 *   conversation    a conversation about a produce listing, a buying request
 *                   or a service whose OWNER marked the post `completed`, in
 *                   which BOTH sides wrote. The post records no counterparty,
 *                   so the conversation is the evidence the two traded; the
 *                   two sides are the post's owner and the person (or
 *                   organisation) who wrote to them.
 *
 * Each side may rate the other ONCE, 1 to 5 stars and an optional comment of
 * at most 300 characters, within 30 days of the deal's completion.
 *
 * Everything here is pure: the eligibility rule, the average and what the
 * public may see are decided by these functions, and the routes only fetch.
 */

export const DEAL_KINDS = ['purchase_order', 'conversation'] as const;
export type DealKind = (typeof DEAL_KINDS)[number];

/** Which side of a deal: an order's buyer or seller, a conversation's owner or starter. */
export const RATER_SIDES = ['buyer', 'seller', 'owner', 'starter'] as const;
export type RaterSide = (typeof RATER_SIDES)[number];

/** Days after completion in which a deal may still be rated. */
export const RATING_WINDOW_DAYS = 30;

export const RATING_COMMENT_MAX = 300;
export const RATING_NOTE_MAX = 500;

/** How many of the latest comments a public profile shows. */
export const RATING_LATEST_SHOWN = 5;

// Each pinned in docs/api/CONVENTIONS.md §5.2.3
export const RATING_MESSAGES = {
  dealKindUnknown: 'Choose a completed order or a completed conversation to rate.',
  starsRequired: 'Choose from 1 to 5 stars.',
  commentTooLong: 'A comment has at most 300 characters.',
  reportReasonUnknown: 'Choose why you are reporting this rating.',
  noteTooLong: 'A note has at most 500 characters.',
  moderationActionUnknown: 'Choose hide, restore or dismiss the report.',
  hideReasonRequired: 'Give the reason for hiding this rating.',
  moderationFilterUnknown: 'Choose reported, hidden or all.',
} as const;

const M = RATING_MESSAGES;

const idSchema = z
  .string({ error: () => BUYER_MESSAGES.identifierMalformed })
  .uuid(BUYER_MESSAGES.identifierMalformed);

/** One rating of a completed deal, from the side the caller is on. */
export const submitRatingSchema = z.strictObject({
  deal_kind: z.enum(DEAL_KINDS, { error: () => M.dealKindUnknown }),
  deal_id: idSchema,
  stars: z
    .number({ error: () => M.starsRequired })
    .int(M.starsRequired)
    .min(1, M.starsRequired)
    .max(5, M.starsRequired),
  comment: z
    .string({ error: () => M.commentTooLong })
    .trim()
    .max(RATING_COMMENT_MAX, M.commentTooLong)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type SubmitRatingInput = z.input<typeof submitRatingSchema>;

/** The rated party reports an abusive rating. The product-report reasons, reused. */
export const reportRatingSchema = z.strictObject({
  reason: z.enum(REPORT_REASONS, { error: () => M.reportReasonUnknown }),
  note: z
    .string({ error: () => M.noteTooLong })
    .trim()
    .max(RATING_NOTE_MAX, M.noteTooLong)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type ReportRatingInput = z.input<typeof reportRatingSchema>;

export const RATING_MODERATION_ACTIONS = ['hide', 'restore', 'dismiss_report'] as const;
export type RatingModerationAction = (typeof RATING_MODERATION_ACTIONS)[number];

/** A moderator hides a rating with a reason, restores it, or dismisses its report. */
export const moderateRatingSchema = z
  .strictObject({
    action: z.enum(RATING_MODERATION_ACTIONS, { error: () => M.moderationActionUnknown }),
    reason: z
      .string({ error: () => M.hideReasonRequired })
      .trim()
      .max(RATING_NOTE_MAX, M.noteTooLong)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'hide' && !v.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: M.hideReasonRequired });
    }
  });
export type ModerateRatingInput = z.infer<typeof moderateRatingSchema>;

export const RATING_MODERATION_FILTERS = ['reported', 'hidden', 'all'] as const;
export type RatingModerationFilter = (typeof RATING_MODERATION_FILTERS)[number];

/** The moderators' queue: open reports (the default), hidden ratings, or every rating. */
export const ratingModerationQuerySchema = z.strictObject({
  filter: z.enum(RATING_MODERATION_FILTERS, { error: () => M.moderationFilterUnknown }).optional(),
});

// ---------------------------------------------------------------------------
// ELIGIBILITY -- only parties, only completed, once, within the window
// ---------------------------------------------------------------------------

export type RatingRefusal =
  'not_party' | 'not_completed' | 'already_rated' | 'window_closed' | 'blocked';

export interface RatingEligibilityInput {
  /** The caller is one of the deal's two sides (for a conversation: both sides wrote). */
  isParty: boolean;
  /** The deal is in its completed state. */
  completed: boolean;
  /** When it was completed; null when unknown (treated as not completed). */
  completedAt: Date | string | null;
  /** The caller's side has already rated this deal. */
  alreadyRated: boolean;
  /** Either person has blocked the other (person-level block). */
  blocked?: boolean;
  now: Date;
}

/** When a deal completed at `completedAt` stops being rateable. */
export function ratingWindowEnds(completedAt: Date | string): Date {
  const at = typeof completedAt === 'string' ? new Date(completedAt) : completedAt;
  return new Date(at.getTime() + RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * THE RULE. Null when the caller may rate; otherwise why not, in the order a
 * caller is told: a stranger learns nothing else (404), then the state of the
 * deal, then the caller's own earlier rating, then the window.
 */
export function ratingRefusal(input: RatingEligibilityInput): RatingRefusal | null {
  if (!input.isParty) return 'not_party';
  if (!input.completed || input.completedAt === null) return 'not_completed';
  if (input.alreadyRated) return 'already_rated';
  if (input.now.getTime() > ratingWindowEnds(input.completedAt).getTime()) return 'window_closed';
  if (input.blocked) return 'blocked';
  return null;
}

// ---------------------------------------------------------------------------
// WHAT THE PUBLIC SEES -- visible ratings, their average and the latest comments
// ---------------------------------------------------------------------------

export interface RatingVisibilityInput {
  hidden_at: Date | string | null;
  deleted_at?: Date | string | null;
  /** The rater's account is live: not removed, not suspended or disabled. */
  rater_live: boolean;
}

/** A hidden, removed, or suspended/disabled rater's rating counts nowhere. */
export const ratingVisible = (row: RatingVisibilityInput): boolean =>
  row.hidden_at === null && (row.deleted_at ?? null) === null && row.rater_live;

/** Mean of the stars to one decimal place, and how many; null average when there are none. */
export function ratingAverage(stars: readonly number[]): {
  average: number | null;
  count: number;
} {
  if (stars.length === 0) return { average: null, count: 0 };
  const sum = stars.reduce((a, b) => a + b, 0);
  return { average: Math.round((sum / stars.length) * 10) / 10, count: stars.length };
}

/** One rating as a public profile shows it. Never an id of the rater. */
export interface PublicRating {
  stars: number;
  comment: string | null;
  /** The name the rater already shows publicly, or null ("An AgriOne member"). */
  rater_name: string | null;
  created_at: string;
}

export interface RatingSummary {
  average: number | null;
  count: number;
  /** The latest visible ratings that carry a comment, newest first. */
  latest: PublicRating[];
}

export interface RatingSummaryRow extends RatingVisibilityInput {
  stars: number;
  comment: string | null;
  rater_name: string | null;
  created_at: Date | string;
}

const iso = (v: Date | string) => (typeof v === 'string' ? new Date(v) : v).toISOString();

/** The public summary from every rating of one party: only the visible ones count. */
export function summarizeRatings(rows: readonly RatingSummaryRow[]): RatingSummary {
  const visible = rows.filter(ratingVisible);
  const latest = [...visible]
    .filter((r) => r.comment !== null && r.comment.trim() !== '')
    .sort((a, b) => iso(b.created_at).localeCompare(iso(a.created_at)))
    .slice(0, RATING_LATEST_SHOWN)
    .map((r) => ({
      stars: r.stars,
      comment: r.comment,
      rater_name: r.rater_name,
      created_at: iso(r.created_at),
    }));
  return { ...ratingAverage(visible.map((r) => r.stars)), latest };
}

// ---------------------------------------------------------------------------
// WHAT THE PARTIES SEE
// ---------------------------------------------------------------------------

/** A completed deal the caller's side has not rated yet. */
export interface DealToRate {
  deal_kind: DealKind;
  deal_id: string;
  /** What was traded: the order's product, or the post's title. */
  title: string;
  /** The other side, as the caller already knows them. */
  other_name: string;
  completed_at: string;
  /** The last day to rate. */
  rate_by: string;
}

/** A rating the caller's side received. */
export interface ReceivedRating {
  id: string;
  stars: number;
  comment: string | null;
  rater_name: string | null;
  created_at: string;
  reported: boolean;
  hidden: boolean;
}

export interface MyRatings {
  to_rate: DealToRate[];
  received: ReceivedRating[];
  summary: RatingSummary;
}

/** One rating in the moderators' queue. */
export interface ModerationRating {
  id: string;
  stars: number;
  comment: string | null;
  rater_name: string | null;
  ratee_name: string | null;
  deal_kind: DealKind;
  created_at: string;
  report_reason: ReportReason | null;
  report_note: string | null;
  reported_at: string | null;
  hidden_at: string | null;
  hidden_reason: string | null;
}
