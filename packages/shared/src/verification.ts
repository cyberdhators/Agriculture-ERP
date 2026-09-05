import { z } from 'zod';

/**
 * Verification (C-6). One definition of the states, the transitions, the
 * reason codes and the inputs, shared by the API and the officer's app.
 *
 * The database CHECK on verification_event.reason_code is generated from
 * REJECTION_REASONS, the same pattern as AUDIT_ACTIONS (B4): the code and the
 * database cannot drift.
 */
export const VERIFICATION_STATES = ['pending', 'verified', 'rejected', 'merged'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const VERIFICATION_DECISIONS = ['verified', 'rejected', 'merged', 'resubmitted'] as const;
export type VerificationDecision = (typeof VERIFICATION_DECISIONS)[number];

/**
 * The transition table (data-model §4, C-6.1). The ONLY place it is written.
 *   pending  → verified | rejected | merged
 *   rejected → pending (resubmission) | merged
 *   verified → merged
 *   merged   → nothing
 */
export const VERIFICATION_TRANSITIONS: Readonly<
  Record<VerificationState, readonly VerificationState[]>
> = {
  pending: ['verified', 'rejected', 'merged'],
  rejected: ['pending', 'merged'],
  verified: ['merged'],
  merged: [],
};

export const canTransition = (from: VerificationState, to: VerificationState): boolean =>
  VERIFICATION_TRANSITIONS[from].includes(to);

/** Fixed reason codes (C-6.3). The code carries the meaning; the note carries the detail. */
export const REJECTION_REASONS = [
  'duplicate',
  'wrong_location',
  'incomplete',
  'not_a_farmer',
  'consent_missing',
  'other',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** A record still pending after MORE than this many days is escalated (C-6.7). */
export const ESCALATION_DAYS = 7;

export const VERIFICATION_LIMITS = { noteMax: 280 } as const;

export const VERIFICATION_MESSAGES = {
  reasonInvalid:
    'Choose a reason: duplicate, wrong_location, incomplete, not_a_farmer, consent_missing or other.',
  noteNotText: 'The note must be text.',
  noteTooLong: 'A note can be at most 280 characters.',
  noteControlChars: 'A note contains printable text only.',
  targetRequired: 'Name the farmer this record is a duplicate of.',
  targetNotUuid: 'The target is not in the expected form.',
  filterEscalatedInvalid: 'Choose true or false.',
} as const;

/** Printable text only: no control characters, no line breaks. */
const NOTE_PATTERN = /^[^\p{Cc}]*$/u;

export const noteSchema = z
  .string({ error: () => VERIFICATION_MESSAGES.noteNotText })
  .trim()
  .max(VERIFICATION_LIMITS.noteMax, VERIFICATION_MESSAGES.noteTooLong)
  .regex(NOTE_PATTERN, VERIFICATION_MESSAGES.noteControlChars);

const uuid = (message: string) =>
  z
    .string({ error: () => message })
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, message);

/**
 * reason_code is OPTIONAL here on purpose: a body without it is valid input,
 * and the route answers 422 `reason_required` — a business rule not met, not
 * malformed input (C-6.3). An empty note is the same as no note.
 */
export const rejectFarmerSchema = z.strictObject({
  reason_code: z
    .enum(REJECTION_REASONS, { error: () => VERIFICATION_MESSAGES.reasonInvalid })
    .optional(),
  note: noteSchema.optional(),
});

export const mergeFarmerSchema = z.strictObject({
  target_id: uuid(VERIFICATION_MESSAGES.targetNotUuid),
  note: noteSchema.optional(),
});

/** verify and resubmit take no body; the wrapper rejects any that arrives. */
export const emptyBodySchema = z.strictObject({});

export const queueFilterSchema = z.strictObject({
  escalated: z
    .enum(['true', 'false'], { error: () => VERIFICATION_MESSAGES.filterEscalatedInvalid })
    .optional(),
  payam: z.string().trim().min(1).optional(),
  county: z.string().trim().min(1).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

export type RejectFarmer = z.infer<typeof rejectFarmerSchema>;
export type MergeFarmer = z.infer<typeof mergeFarmerSchema>;
export type QueueFilter = z.infer<typeof queueFilterSchema>;

/** Whole days since the clock started, floored, never negative. */
export const daysWaiting = (pendingSince: Date, now: Date = new Date()): number =>
  Math.max(0, Math.floor((now.getTime() - pendingSince.getTime()) / 86_400_000));
export const isEscalated = (days: number): boolean => days > ESCALATION_DAYS;
