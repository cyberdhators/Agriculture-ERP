import { z } from 'zod';

import { ADVICE_LANGUAGES, type AdviceLanguage } from './advice';
import { ADVICE_TOPICS, type AdviceTopic } from './advice-topics';

/**
 * OFFICIAL ADVISORY NOTES (2026-10-28, lane-security). CORWADO's
 * specification: "Approved advisory channels, official content publication
 * ... require separately assigned permissions", and infographic 8: "Claim
 * verified credentials or use official advisory publishing -> Admin review ->
 * Approved privileges".
 *
 * ONLY AN APPROVED ADVISER (approval standing and not suspended) may submit a
 * note. It goes into staff review; a member of staff with publishing
 * authority (`content.publish`) publishes it, and it then appears on the
 * adviser's public profile as "Reviewed by CORWADO". Any reviewer
 * (`content.moderate` or `content.publish`) may return it with a note.
 *
 *   submitted --(staff: return, note)--> returned
 *   returned  --(adviser: edit and resubmit)--> submitted
 *   submitted --(staff with content.publish: publish)--> published
 *   published --(staff with content.publish: unpublish, note)--> unpublished
 *   submitted | returned --(adviser: withdraw)--> withdrawn
 *
 * A published note is shown only while its adviser's approval stands and is
 * not suspended. Ordinary advice profiles and requests are untouched.
 */

export const ADVISORY_NOTE_STATUSES = [
  'submitted',
  'returned',
  'published',
  'unpublished',
  'withdrawn',
] as const;
export type AdvisoryNoteStatus = (typeof ADVISORY_NOTE_STATUSES)[number];

export const ADVISORY_NOTE_LIMITS = {
  titleMin: 5,
  titleMax: 200,
  bodyMin: 50,
  bodyMax: 5000,
  topicsMax: 4,
  noteMin: 5,
  noteMax: 1000,
} as const;

const L = ADVISORY_NOTE_LIMITS;

export const ADVISORY_NOTE_MESSAGES = {
  titleInvalid: 'Give the note a title of 5 to 200 characters.',
  bodyInvalid: 'Write the note in 50 to 5000 characters.',
  topicsInvalid: 'Choose one to four subjects from the list.',
  languageUnknown: 'Choose the language the note is written in.',
  actionUnknown: 'Choose return, publish or unpublish.',
  noteInvalid: 'Give a note of 5 to 1000 characters.',
} as const;

const M = ADVISORY_NOTE_MESSAGES;

const text = (min: number, max: number, message: string) =>
  z
    .string({ error: () => message })
    .trim()
    .min(min, message)
    .max(max, message);

/** POST /api/advice/my-provider/notes, and PUT .../notes/:id to resubmit a returned note. */
export const advisoryNoteInputSchema = z.strictObject({
  title: text(L.titleMin, L.titleMax, M.titleInvalid),
  topics: z
    .array(z.enum(ADVICE_TOPICS, { error: () => M.topicsInvalid }), {
      error: () => M.topicsInvalid,
    })
    .min(1, M.topicsInvalid)
    .max(L.topicsMax, M.topicsInvalid)
    .transform((list) => [...new Set(list)]),
  language: z.enum(ADVICE_LANGUAGES, { error: () => M.languageUnknown }),
  body: text(L.bodyMin, L.bodyMax, M.bodyInvalid),
});
export type AdvisoryNoteInput = z.infer<typeof advisoryNoteInputSchema>;

export const ADVISORY_NOTE_REVIEW_ACTIONS = ['return', 'publish', 'unpublish'] as const;
export type AdvisoryNoteReviewAction = (typeof ADVISORY_NOTE_REVIEW_ACTIONS)[number];

/** Which note a review action may be taken on, and where it leaves it. */
export const ADVISORY_NOTE_RULES: Readonly<
  Record<
    AdvisoryNoteReviewAction,
    { from: readonly AdvisoryNoteStatus[]; to: AdvisoryNoteStatus; needsNote: boolean }
  >
> = {
  return: { from: ['submitted'], to: 'returned', needsNote: true },
  publish: { from: ['submitted'], to: 'published', needsNote: false },
  unpublish: { from: ['published'], to: 'unpublished', needsNote: true },
};

/** POST /api/admin/advisory-notes/:id/review { action, note? }. */
export const advisoryNoteReviewSchema = z
  .strictObject({
    action: z.enum(ADVISORY_NOTE_REVIEW_ACTIONS, { error: () => M.actionUnknown }),
    note: text(L.noteMin, L.noteMax, M.noteInvalid).optional(),
  })
  .superRefine((value, ctx) => {
    if (ADVISORY_NOTE_RULES[value.action].needsNote && !value.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: M.noteInvalid });
    }
  });
export type AdvisoryNoteReviewInput = z.infer<typeof advisoryNoteReviewSchema>;

export const advisoryNoteQueueSchema = z.strictObject({
  status: z.enum(ADVISORY_NOTE_STATUSES).default('submitted'),
});

/** A note as its author sees it. */
export interface AdvisoryNoteOwn {
  id: string;
  title: string;
  topics: AdviceTopic[];
  language: AdviceLanguage;
  body: string;
  status: AdvisoryNoteStatus;
  review_note: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A note in the staff review queue: the author's public name, never a sign-in id. */
export interface AdvisoryNoteStaff extends AdvisoryNoteOwn {
  provider: { id: string; display_name: string; approval_active: boolean };
  reviewed_by_name: string | null;
}

/** A published note, as the public sees it on the adviser's profile. */
export interface AdvisoryNotePublic {
  id: string;
  title: string;
  topics: AdviceTopic[];
  language: AdviceLanguage;
  body: string;
  published_at: string;
}
