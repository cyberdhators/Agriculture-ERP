import { z } from 'zod';

import { reasonCodeSchema } from './settings';

/**
 * A MODERATOR ASKS FOR A CORRECTION (2026-10-27). CORWADO's 16 October
 * specification, Marketplace: "Inspect, request correction and moderate with
 * a reason; listing removal is separate from account action."
 *
 * A moderator (content.moderate) names a reason code and writes what needs
 * fixing on a produce listing, a service listing or a buying request. The
 * owner is told (a fixed in-app notice; the note is shown on their own posts,
 * never in the notice), sees "Correction requested" on the post, and the
 * request is marked addressed when they next edit it. THE POST STAYS LIVE:
 * removing it is a separate decision with its own route.
 */

export const CORRECTION_TARGETS = ['produce_listing', 'service_listing', 'buying_request'] as const;
export type CorrectionTarget = (typeof CORRECTION_TARGETS)[number];

/** open: waiting for the owner. addressed: the owner edited the post since. */
export const CORRECTION_STATUSES = ['open', 'addressed'] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

export const CORRECTION_LIMITS = { noteMin: 5, noteMax: 500 } as const;

// Each pinned in docs/api/CONVENTIONS.md §5.2.3
export const LISTING_CORRECTION_MESSAGES = {
  targetUnknown: 'Choose a produce listing, a service listing or a buying request.',
  targetIdInvalid: 'That post could not be found.',
  reasonCodeRequired: 'Choose a reason code.',
  reasonCodeNotOffered: 'Choose a reason code from the list.',
  noteInvalid: `Say what needs correcting, in ${CORRECTION_LIMITS.noteMin} to ${CORRECTION_LIMITS.noteMax} characters.`,
  statusUnknown: 'Choose open or addressed.',
} as const;
const M = LISTING_CORRECTION_MESSAGES;

const uuid = z
  .string({ error: () => M.targetIdInvalid })
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, M.targetIdInvalid);

/** POST /api/admin/corrections */
export const correctionRequestSchema = z.strictObject({
  target_type: z.enum(CORRECTION_TARGETS, { error: () => M.targetUnknown }),
  target_id: uuid,
  reason_code: z.string({ error: () => M.reasonCodeRequired }).pipe(reasonCodeSchema),
  note: z
    .string({ error: () => M.noteInvalid })
    .trim()
    .min(CORRECTION_LIMITS.noteMin, M.noteInvalid)
    .max(CORRECTION_LIMITS.noteMax, M.noteInvalid),
});
export type CorrectionRequestInput = z.infer<typeof correctionRequestSchema>;

/** GET /api/admin/corrections?status=&target_type=&target_id= */
export const correctionListQuerySchema = z.strictObject({
  status: z.enum(CORRECTION_STATUSES, { error: () => M.statusUnknown }).optional(),
  target_type: z.enum(CORRECTION_TARGETS, { error: () => M.targetUnknown }).optional(),
  target_id: uuid.optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});
export type CorrectionListQuery = z.infer<typeof correctionListQuerySchema>;

/** One correction request, as the moderator's list and the owner's own posts read it. */
export interface ListingCorrection {
  id: string;
  target_type: CorrectionTarget;
  target_id: string;
  /** The post's title as it is now; absent once the post has been removed. */
  target_title?: string;
  reason_code: string;
  /** The code's label as CORWADO keeps it, or the code itself if it is no longer listed. */
  reason_label: string;
  note: string;
  status: CorrectionStatus;
  requested_at: string;
  addressed_at: string | null;
}

/**
 * Fields an owner's save may carry that do NOT correct anything: a lifecycle
 * move (publish, pause, resume, withdraw, complete) or a renewal of the end
 * date. A save that changes only these leaves an open request open.
 */
const LIFECYCLE_ONLY = new Set(['status', 'available_until', 'needed_by']);

/**
 * Whether an owner's save addresses an open correction: it must change at
 * least one field of the post's content. The names are the keys the save
 * actually sent (undefined values dropped by the caller).
 */
export function editAddressesCorrection(changedKeys: readonly string[]): boolean {
  return changedKeys.some((key) => !LIFECYCLE_ONLY.has(key));
}

/** The status after an owner's save, from the status before it. Addressed stays addressed. */
export function correctionStatusAfterEdit(
  status: CorrectionStatus,
  changedKeys: readonly string[],
): CorrectionStatus {
  if (status === 'addressed') return 'addressed';
  return editAddressesCorrection(changedKeys) ? 'addressed' : 'open';
}
