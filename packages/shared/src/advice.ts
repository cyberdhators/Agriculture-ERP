import { z } from 'zod';

import { ADVICE_TOPICS, type AdviceTopic } from './advice-topics';
import { BUYER_MESSAGES } from './buyer';
import { locationCodeSchema } from './location';
import { MARKET_POST_MESSAGES } from './market-posts';

/**
 * INDEPENDENT ADVICE (2026-10-22), part 1: find a provider and ask. CORWADO's
 * 16 October specification, "Independent knowledge providers" and "Support
 * and advisory outcomes". docs/DECISIONS.md, "Advice: find a provider and ask".
 *
 * A PROVIDER is any signed-in account (farmer or buyer side) that publishes an
 * advice profile: an independent adviser, an institute, a research or training
 * body, an advisory organisation. No CORWADO approval is needed to publish;
 * public visibility is not endorsement. (The "approved adviser" pathway is a
 * later piece of work and adds to this, it does not replace it.)
 *
 * A CASE is one person's question to the provider THEY chose -- nobody is
 * assigned. It is private to the two of them, carries its own conversation
 * (the in-app messaging thread), and moves open -> in progress -> closed with
 * an outcome. A provider's answer is not guaranteed, and advice given is not
 * evidence of a better yield or income; the screens say so.
 *
 * Payments are out of scope: a provider states free or paid terms in words.
 */

// ---------------------------------------------------------------------------
// THE LISTS
// ---------------------------------------------------------------------------

export const ADVICE_PROVIDER_KINDS = [
  'independent_adviser',
  'institute',
  'research_training',
  'advisory_organization',
  'other',
] as const;
export type AdviceProviderKind = (typeof ADVICE_PROVIDER_KINDS)[number];

/** Languages an adviser can work in. Not the app's own two-language list. */
export const ADVICE_LANGUAGES = [
  'en',
  'ar',
  'juba_arabic',
  'dinka',
  'nuer',
  'bari',
  'other',
] as const;
export type AdviceLanguage = (typeof ADVICE_LANGUAGES)[number];

export const ADVICE_DELIVERY_MODES = ['remote', 'in_person'] as const;
export type AdviceDeliveryMode = (typeof ADVICE_DELIVERY_MODES)[number];

/** Terms are words, never a payment: payments are out of scope. */
export const ADVICE_TERMS = ['free', 'paid', 'free_and_paid'] as const;
export type AdviceTerms = (typeof ADVICE_TERMS)[number];

/** A profile is private until its owner publishes it, and can be taken down again. */
export const ADVICE_PROVIDER_STATUSES = ['draft', 'published', 'unpublished'] as const;
export type AdviceProviderStatus = (typeof ADVICE_PROVIDER_STATUSES)[number];

export const ADVICE_CONTACT_MODES = ['in_app', 'phone', 'sms'] as const;
export type AdviceContactMode = (typeof ADVICE_CONTACT_MODES)[number];

export const ADVICE_CASE_STATUSES = ['open', 'in_progress', 'closed'] as const;
export type AdviceCaseStatus = (typeof ADVICE_CASE_STATUSES)[number];

export const ADVICE_OUTCOMES = ['resolved', 'referred', 'closed_unresolved', 'cancelled'] as const;
export type AdviceOutcome = (typeof ADVICE_OUTCOMES)[number];

/**
 * Who may close with which outcome. The requester judges whether they were
 * helped, or withdraws the question; the provider may pass it on or say it
 * could not be answered. Either may close a case that went nowhere.
 */
export const ADVICE_OUTCOMES_BY_SIDE: Record<'requester' | 'provider', readonly AdviceOutcome[]> = {
  requester: ['resolved', 'closed_unresolved', 'cancelled'],
  provider: ['referred', 'closed_unresolved'],
};

export const ADVICE_CASE_ACTIONS = ['start', 'close', 'feedback'] as const;
export type AdviceCaseAction = (typeof ADVICE_CASE_ACTIONS)[number];

/** New advice requests one account may send in a day: the brake on spam. */
export const ADVICE_CASES_PER_DAY = 10;

export const ADVICE_LIMITS = {
  displayNameMin: 2,
  displayNameMax: 120,
  descriptionMin: 10,
  descriptionMax: 2000,
  availabilityMax: 300,
  feeNoteMax: 300,
  commercialMax: 500,
  questionMin: 10,
  questionMax: 2000,
  commentMax: 1000,
  statesMax: 20,
  searchMax: 100,
} as const;

const L = ADVICE_LIMITS;

// ---------------------------------------------------------------------------
// MESSAGES -- each pinned in docs/api/CONVENTIONS.md §5.2.3
// ---------------------------------------------------------------------------

export const ADVICE_MESSAGES = {
  displayNameInvalid: 'A name for your advice profile is 2 to 120 characters.',
  providerKindUnknown:
    'Choose adviser, institute, research or training body, advisory organisation or other.',
  descriptionInvalid: 'Describe the advice you offer in 10 to 2000 characters.',
  topicsRequired: 'Choose at least one topic you advise on.',
  topicUnknown: 'Choose a topic from the list.',
  languagesRequired: 'Choose at least one language you give advice in.',
  languageUnknown: 'Choose a language from the list.',
  statesInvalid: 'Choose up to 20 states from the list, or none to cover anywhere.',
  deliveryRequired: 'Choose remote, in person, or both.',
  deliveryUnknown: 'Choose remote or in person.',
  availabilityTooLong: 'Availability can be at most 300 characters.',
  termsUnknown: 'Choose free, paid, or free and paid.',
  feeNoteTooLong: 'A note on fees can be at most 300 characters.',
  commercialTooLong: 'Commercial interests can be at most 500 characters.',
  statusUnknown: 'Choose draft, published or unpublished.',
  questionInvalid: 'Write your question in 10 to 2000 characters.',
  contactUnknown: 'Choose in the app, a phone call or an SMS.',
  contactNeedsShare:
    'To be called or sent an SMS, tick the box to share your details with this adviser.',
  roleUnknown: 'Choose requester or provider.',
  actionUnknown: 'Choose start, close or feedback.',
  outcomeUnknown: 'Choose resolved, referred, closed unresolved or cancelled.',
  ratingInvalid: 'Give a rating from 1 to 5 stars.',
  commentTooLong: 'A comment can be at most 1000 characters.',
  fieldNotForAction: 'This field is not used for that change.',
} as const;

const M = ADVICE_MESSAGES;

// ---------------------------------------------------------------------------
// BUILDING BLOCKS
// ---------------------------------------------------------------------------

const idSchema = z
  .string({ error: () => BUYER_MESSAGES.identifierMalformed })
  .uuid(BUYER_MESSAGES.identifierMalformed);

const text = (min: number, max: number, message: string) =>
  z
    .string({ error: () => message })
    .trim()
    .min(min, message)
    .max(max, message);

/** Optional text: blank is no text, and is stored as null. */
const optionalText = (max: number, message: string) =>
  z
    .string({ error: () => message })
    .trim()
    .max(max, message)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

/** A list of choices from one list, each once, at least `min`. */
function choices<T extends readonly [string, ...string[]]>(
  values: T,
  options: { min: number; max: number; required: string; unknown: string },
) {
  return z
    .array(z.enum(values, { error: () => options.unknown }), { error: () => options.required })
    .min(options.min, options.required)
    .max(options.max, options.unknown)
    .transform((list) => [...new Set(list)]);
}

const topicSchema = z.enum(ADVICE_TOPICS, { error: () => M.topicUnknown });

// ---------------------------------------------------------------------------
// THE PROVIDER PROFILE -- PUT /api/advice/my-provider
// ---------------------------------------------------------------------------

/**
 * One profile per account, saved whole (PUT). The owner chooses whether it is
 * public: `published` puts it in the directory at once, with no review;
 * `unpublished` takes it down. Fees and commercial interests are disclosed
 * here, in the provider's own words.
 */
export const adviceProviderSchema = z.strictObject({
  display_name: text(L.displayNameMin, L.displayNameMax, M.displayNameInvalid),
  provider_kind: z.enum(ADVICE_PROVIDER_KINDS, { error: () => M.providerKindUnknown }),
  description: text(L.descriptionMin, L.descriptionMax, M.descriptionInvalid),
  topics: choices(ADVICE_TOPICS, {
    min: 1,
    max: ADVICE_TOPICS.length * 2,
    required: M.topicsRequired,
    unknown: M.topicUnknown,
  }),
  languages: choices(ADVICE_LANGUAGES, {
    min: 1,
    max: ADVICE_LANGUAGES.length * 2,
    required: M.languagesRequired,
    unknown: M.languageUnknown,
  }),
  // The states served; none means anywhere.
  state_ids: z
    .array(
      z
        .string({ error: () => M.statesInvalid })
        .trim()
        .regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/, M.statesInvalid),
      { error: () => M.statesInvalid },
    )
    .max(L.statesMax, M.statesInvalid)
    .default([])
    .transform((list) => [...new Set(list)]),
  delivery_modes: choices(ADVICE_DELIVERY_MODES, {
    min: 1,
    max: 4,
    required: M.deliveryRequired,
    unknown: M.deliveryUnknown,
  }),
  availability: optionalText(L.availabilityMax, M.availabilityTooLong),
  terms: z.enum(ADVICE_TERMS, { error: () => M.termsUnknown }),
  fee_note: optionalText(L.feeNoteMax, M.feeNoteTooLong),
  commercial_interests: optionalText(L.commercialMax, M.commercialTooLong),
  status: z.enum(ADVICE_PROVIDER_STATUSES, { error: () => M.statusUnknown }).default('draft'),
});
export type AdviceProviderInput = z.infer<typeof adviceProviderSchema>;

/** GET /api/advice/providers: search and filters. Every one optional. */
export const adviceProviderFilterSchema = z.strictObject({
  q: z
    .string({ error: () => BUYER_MESSAGES.searchTooLong })
    .trim()
    .max(L.searchMax, BUYER_MESSAGES.searchTooLong)
    .optional(),
  topic: topicSchema.optional(),
  language: z.enum(ADVICE_LANGUAGES, { error: () => M.languageUnknown }).optional(),
  state_id: locationCodeSchema.optional(),
  delivery_mode: z.enum(ADVICE_DELIVERY_MODES, { error: () => M.deliveryUnknown }).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});
export type AdviceProviderFilter = z.infer<typeof adviceProviderFilterSchema>;

// ---------------------------------------------------------------------------
// THE CASE -- POST /api/advice/cases, PATCH /api/advice/cases/:id
// ---------------------------------------------------------------------------

/**
 * A question to one provider. The id is made on the phone, so a request sent
 * twice is stored once. Sharing details is OFF unless the person ticks it
 * (the specification: acknowledgements start unchecked); a phone call or an
 * SMS needs the number, so asking for one needs the tick.
 */
export const adviceCaseCreateSchema = z
  .strictObject({
    id: idSchema,
    provider_id: idSchema,
    topic: topicSchema,
    question: text(L.questionMin, L.questionMax, M.questionInvalid),
    preferred_contact: z
      .enum(ADVICE_CONTACT_MODES, { error: () => M.contactUnknown })
      .default('in_app'),
    share_details: z.boolean({ error: () => MARKET_POST_MESSAGES.choiceUnknown }).default(false),
  })
  .superRefine((value, ctx) => {
    if (value.preferred_contact !== 'in_app' && !value.share_details) {
      ctx.addIssue({ code: 'custom', path: ['preferred_contact'], message: M.contactNeedsShare });
    }
  });
export type AdviceCaseCreate = z.infer<typeof adviceCaseCreateSchema>;

/** GET /api/advice/cases: the caller's cases as the asker, or as the provider. */
export const adviceCaseListSchema = z.strictObject({
  role: z.enum(['requester', 'provider'], { error: () => M.roleUnknown }).default('requester'),
});

/**
 * One change to a case, named by `action`:
 *   start     the provider takes it up: open -> in progress
 *   close     either side closes it with an outcome (ADVICE_OUTCOMES_BY_SIDE)
 *   feedback  the requester rates it once it is closed, once
 * Who may do which is the route's to decide; this is only the shape.
 */
export const adviceCasePatchSchema = z
  .strictObject({
    action: z.enum(ADVICE_CASE_ACTIONS, { error: () => M.actionUnknown }),
    outcome: z.enum(ADVICE_OUTCOMES, { error: () => M.outcomeUnknown }).optional(),
    rating: z
      .number({ error: () => M.ratingInvalid })
      .int(M.ratingInvalid)
      .min(1, M.ratingInvalid)
      .max(5, M.ratingInvalid)
      .optional(),
    comment: optionalText(L.commentMax, M.commentTooLong),
  })
  .superRefine((value, ctx) => {
    const need = (key: 'outcome' | 'rating', message: string) => {
      if (value[key] === undefined) ctx.addIssue({ code: 'custom', path: [key], message });
    };
    const refuse = (key: 'outcome' | 'rating' | 'comment') => {
      if (value[key] !== undefined && value[key] !== null) {
        ctx.addIssue({ code: 'custom', path: [key], message: M.fieldNotForAction });
      }
    };
    if (value.action === 'start') {
      refuse('outcome');
      refuse('rating');
      refuse('comment');
    } else if (value.action === 'close') {
      need('outcome', M.outcomeUnknown);
      refuse('rating');
      refuse('comment');
    } else {
      need('rating', M.ratingInvalid);
      refuse('outcome');
    }
  });
export type AdviceCasePatch = z.infer<typeof adviceCasePatchSchema>;

// ---------------------------------------------------------------------------
// WHAT LEAVES THE API
// ---------------------------------------------------------------------------

/** A provider as the public directory shows it. Never a phone, never an account id. */
export interface AdviceProviderPublic {
  id: string;
  display_name: string;
  provider_kind: AdviceProviderKind;
  description: string;
  topics: AdviceTopic[];
  languages: AdviceLanguage[];
  states: { id: string; name: string }[];
  delivery_modes: AdviceDeliveryMode[];
  availability: string | null;
  terms: AdviceTerms;
  fee_note: string | null;
  commercial_interests: string | null;
  updated_at: string;
}

/** The owner's own profile: the public fields, its status and when it was made. */
export interface AdviceProviderOwn extends AdviceProviderPublic {
  status: AdviceProviderStatus;
  state_ids: string[];
  created_at: string;
}

/** A case from one participant's side. */
export interface AdviceCaseView {
  id: string;
  my_side: 'requester' | 'provider';
  provider: { id: string; display_name: string };
  requester_name: string;
  topic: AdviceTopic;
  question: string;
  preferred_contact: AdviceContactMode;
  share_details: boolean;
  /**
   * What the requester chose to share, shown to the provider only: their
   * general place, and their phone when they asked to be called or texted.
   */
  shared: { place: string | null; phone: string | null } | null;
  status: AdviceCaseStatus;
  outcome: AdviceOutcome | null;
  closed_at: string | null;
  closed_by_me: boolean;
  feedback_rating: number | null;
  feedback_comment: string | null;
  conversation_id: string | null;
  unread: boolean;
  created_at: string;
  updated_at: string;
}
