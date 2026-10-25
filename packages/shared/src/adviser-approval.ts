import { z } from 'zod';

import { ADVICE_LANGUAGES, ADVICE_LIMITS, ADVICE_MESSAGES, type AdviceLanguage } from './advice';
import { ADVICE_TOPICS, type AdviceTopic } from './advice-topics';

/**
 * INDEPENDENT ADVICE (2026-10-24), part 2: the OPTIONAL "approved adviser"
 * pathway. CORWADO's 16 October specification: "An existing user applies with
 * specialties, service area, languages, experience, qualifications and
 * affiliation. An authorized administrator requests clarification, approves
 * or declines with a recorded reason." docs/DECISIONS.md, "Approved advisers:
 * optional, reviewed, revocable".
 *
 * OPTIONAL AND SEPARATE. Anyone with an advice profile can already publish it
 * and take requests (part 1); approval adds a reviewed "Approved adviser"
 * badge and nothing is taken away while an application is under review or
 * after it is declined. Buying, selling and every ordinary function stay as
 * they are.
 *
 * THE LIFE OF AN APPLICATION:
 *   submitted --(staff: request_clarification)--> clarification_requested
 *   clarification_requested --(applicant: reply)--> submitted
 *   submitted | clarification_requested --(staff: approve)--> approved
 *   submitted | clarification_requested --(staff: decline)--> declined
 *   submitted | clarification_requested --(applicant: withdraw)--> withdrawn
 *   approved --(staff: revoke)--> revoked
 *   2026-10-28 (lane-security), CORWADO's "Suspend advisory access" and
 *   "Restore authorization", kept apart from account status:
 *   approved --(staff: suspend, reason, 1-365 days)--> suspended
 *   suspended --(staff: restore)--> approved
 *   suspended --(staff: revoke)--> revoked
 *   A suspension LAPSES by itself at its end date (effectiveAdviserStatus).
 * Only approval grants the badge, and not while suspended. Declined, withdrawn and revoked are final
 * for that application; the provider may apply again with a new one.
 * Account suspension and restoration never move an application.
 */

export const ADVISER_APPLICATION_STATUSES = [
  'submitted',
  'clarification_requested',
  'approved',
  'declined',
  'revoked',
  'withdrawn',
  'suspended',
] as const;
export type AdviserApplicationStatus = (typeof ADVISER_APPLICATION_STATUSES)[number];

/** Still with CORWADO: one at a time per provider. */
export const ADVISER_OPEN_STATUSES = ['submitted', 'clarification_requested'] as const;

export const ADVISER_DECISIONS = [
  'request_clarification',
  'approve',
  'decline',
  'revoke',
  'suspend',
  'restore',
] as const;
export type AdviserDecision = (typeof ADVISER_DECISIONS)[number];

/** Which application a decision may be made on, and where it leaves it. */
export const ADVISER_DECISION_RULES: Readonly<
  Record<
    AdviserDecision,
    { from: readonly AdviserApplicationStatus[]; to: AdviserApplicationStatus }
  >
> = {
  request_clarification: { from: ['submitted'], to: 'clarification_requested' },
  approve: { from: ['submitted', 'clarification_requested'], to: 'approved' },
  decline: { from: ['submitted', 'clarification_requested'], to: 'declined' },
  revoke: { from: ['approved', 'suspended'], to: 'revoked' },
  suspend: { from: ['approved'], to: 'suspended' },
  restore: { from: ['suspended'], to: 'approved' },
};

/**
 * Where an application stands NOW. A suspension whose end has passed reads as
 * approved -- it lapsed by itself -- so the badge returns without anyone
 * writing, and the decision rules see an approval that may be suspended again.
 */
export function effectiveAdviserStatus(
  status: AdviserApplicationStatus,
  suspendedUntil: Date | string | null,
  nowMs: number,
): AdviserApplicationStatus {
  if (status !== 'suspended') return status;
  if (suspendedUntil && new Date(suspendedUntil).getTime() > nowMs) return 'suspended';
  return 'approved';
}

/**
 * WHAT CORWADO CHECKED before approving, shown publicly as the verification
 * panel. The approving staff member ticks what they actually checked; at
 * least one is required. Nothing here is a document the public can see.
 */
export const ADVISER_CHECKS = [
  'identity',
  'experience',
  'qualifications',
  'affiliation',
  'service_area',
  'languages',
  'interests_disclosed',
] as const;
export type AdviserCheck = (typeof ADVISER_CHECKS)[number];

export const ADVISER_CHECK_LABELS: Readonly<Record<AdviserCheck, string>> = {
  identity: 'Identity confirmed',
  experience: 'Experience reviewed',
  qualifications: 'Qualifications reviewed',
  affiliation: 'Affiliation confirmed',
  service_area: 'Service area confirmed',
  languages: 'Languages confirmed',
  interests_disclosed: 'Commercial interests disclosed',
};

/** A suspension lasts 1 to 365 days, then lapses by itself. */
export const ADVISER_SUSPENSION_DAYS = { min: 1, max: 365 } as const;

export const ADVISER_LIMITS = {
  experienceMin: 20,
  experienceMax: 2000,
  qualificationsMax: 2000,
  affiliationMax: 300,
  replyMin: 5,
  replyMax: 2000,
  reasonMin: 5,
  reasonMax: 1000,
  statesMax: ADVICE_LIMITS.statesMax,
} as const;

const L = ADVISER_LIMITS;

// ---------------------------------------------------------------------------
// MESSAGES -- each pinned in docs/api/CONVENTIONS.md §5.2.3
// ---------------------------------------------------------------------------

export const ADVISER_MESSAGES = {
  specialtiesRequired: 'Choose at least one subject you specialise in.',
  experienceInvalid: 'Describe your experience in 20 to 2000 characters.',
  qualificationsTooLong: 'Qualifications can be at most 2000 characters.',
  affiliationTooLong: 'An affiliation can be at most 300 characters.',
  acknowledgementRequired: 'Tick the box to confirm this statement.',
  replyInvalid: 'Write your answer in 5 to 2000 characters.',
  decisionUnknown: 'Choose request clarification, approve, decline, revoke, suspend or restore.',
  suspendDaysInvalid: 'Choose how long the suspension lasts: 1 to 365 days.',
  checksRequired: 'Tick at least one thing you checked before approving.',
  checkUnknown: 'Choose what was checked from the list.',
  fieldNotForDecision: 'This field is not used for that decision.',
  reasonInvalid: 'Give a reason of 5 to 1000 characters.',
  statusUnknown:
    'Choose submitted, clarification requested, approved, suspended, declined, revoked or withdrawn.',
} as const;

const M = ADVISER_MESSAGES;

const text = (min: number, max: number, message: string) =>
  z
    .string({ error: () => message })
    .trim()
    .min(min, message)
    .max(max, message);

const optionalText = (max: number, message: string) =>
  z
    .string({ error: () => message })
    .trim()
    .max(max, message)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

/** Only a tick is accepted: the form shows each box UNTICKED. */
const acknowledgement = z.literal(true, { error: () => M.acknowledgementRequired });

// ---------------------------------------------------------------------------
// THE APPLICANT -- POST /api/advice/my-provider/application (+ /reply, /withdraw)
// ---------------------------------------------------------------------------

export const adviserApplicationSchema = z.strictObject({
  specialties: z
    .array(z.enum(ADVICE_TOPICS, { error: () => ADVICE_MESSAGES.topicUnknown }), {
      error: () => M.specialtiesRequired,
    })
    .min(1, M.specialtiesRequired)
    .max(ADVICE_TOPICS.length * 2, ADVICE_MESSAGES.topicUnknown)
    .transform((list) => [...new Set(list)]),
  // State ids served; none means anywhere.
  service_area: z
    .array(
      z
        .string({ error: () => ADVICE_MESSAGES.statesInvalid })
        .trim()
        .regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/, ADVICE_MESSAGES.statesInvalid),
      { error: () => ADVICE_MESSAGES.statesInvalid },
    )
    .max(L.statesMax, ADVICE_MESSAGES.statesInvalid)
    .default([])
    .transform((list) => [...new Set(list)]),
  languages: z
    .array(z.enum(ADVICE_LANGUAGES, { error: () => ADVICE_MESSAGES.languageUnknown }), {
      error: () => ADVICE_MESSAGES.languagesRequired,
    })
    .min(1, ADVICE_MESSAGES.languagesRequired)
    .max(ADVICE_LANGUAGES.length * 2, ADVICE_MESSAGES.languageUnknown)
    .transform((list) => [...new Set(list)]),
  experience: text(L.experienceMin, L.experienceMax, M.experienceInvalid),
  qualifications: optionalText(L.qualificationsMax, M.qualificationsTooLong),
  affiliation: optionalText(L.affiliationMax, M.affiliationTooLong),
  accurate_information: acknowledgement,
  disclose_interests: acknowledgement,
});
export type AdviserApplicationInput = z.infer<typeof adviserApplicationSchema>;

/** The applicant answers CORWADO's question; the application goes back to review. */
export const adviserReplySchema = z.strictObject({
  reply: text(L.replyMin, L.replyMax, M.replyInvalid),
});

// ---------------------------------------------------------------------------
// STAFF -- GET /api/admin/advisers, POST /api/admin/advisers/:id/decision
// ---------------------------------------------------------------------------

/**
 * One staff decision, always with a reason: the question itself for a
 * clarification, the recorded reason for the rest. Which application it may
 * be made on is ADVISER_DECISION_RULES, which the route enforces.
 */
export const adviserDecisionSchema = z
  .strictObject({
    action: z.enum(ADVISER_DECISIONS, { error: () => M.decisionUnknown }),
    reason: text(L.reasonMin, L.reasonMax, M.reasonInvalid),
    /** suspend only: how many days, 1-365. */
    suspend_days: z
      .number({ error: () => M.suspendDaysInvalid })
      .int(M.suspendDaysInvalid)
      .min(ADVISER_SUSPENSION_DAYS.min, M.suspendDaysInvalid)
      .max(ADVISER_SUSPENSION_DAYS.max, M.suspendDaysInvalid)
      .optional(),
    /** approve only: what the staff member checked; at least one. */
    checks: z
      .array(z.enum(ADVISER_CHECKS, { error: () => M.checkUnknown }), {
        error: () => M.checksRequired,
      })
      .max(ADVISER_CHECKS.length * 2, M.checkUnknown)
      .transform((list) => [...new Set(list)])
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'suspend' && value.suspend_days === undefined) {
      ctx.addIssue({ code: 'custom', path: ['suspend_days'], message: M.suspendDaysInvalid });
    }
    if (value.action !== 'suspend' && value.suspend_days !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['suspend_days'], message: M.fieldNotForDecision });
    }
    if (value.action === 'approve' && (value.checks ?? []).length === 0) {
      ctx.addIssue({ code: 'custom', path: ['checks'], message: M.checksRequired });
    }
    if (value.action !== 'approve' && value.checks !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['checks'], message: M.fieldNotForDecision });
    }
  });
export type AdviserDecisionInput = z.infer<typeof adviserDecisionSchema>;

export const adviserQueueFilterSchema = z.strictObject({
  status: z
    .enum(ADVISER_APPLICATION_STATUSES, { error: () => M.statusUnknown })
    .default('submitted'),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

// ---------------------------------------------------------------------------
// WHAT LEAVES THE API
// ---------------------------------------------------------------------------

/** An application as its own applicant sees it. */
export interface AdviserApplicationOwn {
  id: string;
  specialties: AdviceTopic[];
  service_area: string[];
  languages: AdviceLanguage[];
  experience: string;
  qualifications: string | null;
  affiliation: string | null;
  status: AdviserApplicationStatus;
  /** CORWADO's latest question, while one is asked or was asked. */
  clarification_request: string | null;
  applicant_reply: string | null;
  /** The reason recorded with an approval, a decline or a revocation. */
  decision_reason: string | null;
  decided_at: string | null;
  /** 2026-10-28: while suspended, when it ends by itself, and why. */
  suspended_until: string | null;
  suspension_reason: string | null;
  /** 2026-10-28: what CORWADO checked when approving. */
  verified_checks: AdviserCheck[];
  created_at: string;
  updated_at: string;
}

/** GET /api/advice/my-provider/application. */
export interface AdviserApplicationState {
  /** Whether the provider holds the badge now. */
  approved: boolean;
  approved_at: string | null;
  /** 2026-10-28: the approval is paused until then (the badge is hidden meanwhile). */
  suspended_until?: string | null;
  /** The newest application, or null when there has never been one. */
  current: AdviserApplicationOwn | null;
  /** Every application, newest first (includes `current`). */
  history: AdviserApplicationOwn[];
}

/** An application as the staff queue sees it. No phone, no sign-in id. */
export interface AdviserApplicationStaff extends AdviserApplicationOwn {
  provider: {
    id: string;
    display_name: string;
    provider_kind: string;
    status: string;
    description: string;
    commercial_interests: string | null;
    approved_at: string | null;
  };
  /** Which side of the platform the applying account has, and its standing. */
  account: { farmer: boolean; buyer: boolean; suspended: boolean };
  decided_by_name: string | null;
}
