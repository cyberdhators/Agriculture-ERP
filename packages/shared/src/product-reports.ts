import { z } from 'zod';

/**
 * MARKETPLACE PRODUCT REPORTS — THE CONTRACT, AHEAD OF THE BACKEND.
 *
 * Proposed 2026-09-17 and approved by the developers as an addition to scope.
 *
 * NOTHING BEHIND THIS EXISTS YET, and the dependency chain is longer than the
 * screen suggests: there is no listing table, no listing API, and no report
 * submission path. A report is about a listing, so listings must exist first.
 * This file is the shape the administrator queue is built against, so that the
 * backend can be written to a contract rather than to a screenshot.
 *
 * REASONS AND STATUSES BELOW ARE PROPOSED, NOT APPROVED. They are the starting
 * point the 17 September position paper asked CORWADO to correct — the codes
 * that matter in a South Sudan produce marketplace may not be these. The route
 * is the authority once it exists; the UI reads what it is given and falls back
 * safely for a value it does not recognise.
 */

/** PROPOSED. Awaiting CORWADO's correction. */
export const REPORT_REASONS = [
  'prohibited_content',
  'misleading_listing',
  'counterfeit_or_fraud',
  'inappropriate_content',
  'duplicate_or_spam',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** PROPOSED. The backend owns the transition rules when it is built. */
export const REPORT_STATUSES = ['new', 'reviewing', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const PRODUCT_REPORT_LIMITS = { descriptionMax: 500 } as const;

export const PRODUCT_REPORT_MESSAGES = {
  reasonUnknown: 'Choose a reason from the list.',
  statusUnknown: 'That is not a report status.',
  descriptionTooLong: `A description has at most ${PRODUCT_REPORT_LIMITS.descriptionMax} characters.`,
} as const;

/**
 * One report, as the administrator queue expects to receive it — PROPOSED.
 *
 * NOTE WHAT IS ABSENT: there is no reporter name, phone or address. A
 * marketplace visitor holds no account (DECISIONS, 2026-09-09), so a report
 * would make the REPORTER personal data as well as the listing. Whether
 * anything identifying is stored at all is an open question in the position
 * paper; until it is answered the contract carries nothing, which is the
 * direction that can be widened later without a privacy incident.
 */
export interface ProductReport {
  id: string;
  listing_id: string;
  /** Present only if the listing is still readable; a removed listing keeps its id. */
  listing_title?: string;
  vendor_id?: string;
  vendor_name?: string;
  reason: ReportReason | string;
  description?: string | null;
  status: ReportStatus | string;
  created_at: string;
  updated_at: string;
  resolved_by?: string | null;
  resolved_at?: string | null;
}

/** Filters the list endpoint is proposed to accept. Cursor-paged like every list. */
export const productReportFilterSchema = z.strictObject({
  status: z
    .enum(REPORT_STATUSES, { error: () => PRODUCT_REPORT_MESSAGES.statusUnknown })
    .optional(),
  reason: z.enum(REPORT_REASONS, { error: () => PRODUCT_REPORT_MESSAGES.reasonUnknown }).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});
export type ProductReportFilter = z.infer<typeof productReportFilterSchema>;

/**
 * A moderation decision — PROPOSED.
 *
 * Each of these needs a real state transition and its own authorization on the
 * server. None exists. A removal, if it is built, is SOFT: the deletion law
 * admits no exception, and no screen should offer words suggesting otherwise.
 */
export const MODERATION_ACTIONS = [
  'mark_reviewing',
  'resolve',
  'dismiss',
  'remove_listing',
  'suspend_listing',
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const moderateReportSchema = z.strictObject({
  action: z.enum(MODERATION_ACTIONS),
  note: z
    .string()
    .trim()
    .max(PRODUCT_REPORT_LIMITS.descriptionMax, PRODUCT_REPORT_MESSAGES.descriptionTooLong)
    .optional(),
});
export type ModerateReport = z.infer<typeof moderateReportSchema>;

/**
 * The unread count — PROPOSED.
 *
 * It must come from the database: a count of reports in the `new` state. It is
 * explicitly NOT derived from a loaded page, from browser storage, or from
 * anything a client can compute. Until the route exists no badge is shown at
 * all, because a badge is a figure and this system does not print a figure it
 * cannot source.
 */
export interface UnreadReportCount {
  unread: number;
}

/**
 * What a marketplace visitor submits — `POST /api/listings/:id/reports`.
 *
 * The ONLY unauthenticated write besides the contact request. It carries no
 * identity because the submitter has none, and it asks for none: a reason, and
 * optionally a sentence. Nothing about the person reaches the database.
 */
export const submitProductReportSchema = z.strictObject({
  reason: z.enum(REPORT_REASONS, { error: () => PRODUCT_REPORT_MESSAGES.reasonUnknown }),
  description: z
    .string()
    .trim()
    .max(PRODUCT_REPORT_LIMITS.descriptionMax, PRODUCT_REPORT_MESSAGES.descriptionTooLong)
    .optional(),
});
export type SubmitProductReport = z.infer<typeof submitProductReportSchema>;
