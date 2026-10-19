import { z } from 'zod';

import { ADVICE_TOPICS, type AdviceTopic } from './advice-topics';

/**
 * The learning resource centre, deliverable (m). Unit P1, criteria C-13.6 to
 * C-13.9.
 *
 * A repository, not a course system: no enrolment, progress, quizzes or
 * certificates. Those are in the client's application document and not in the
 * contract (docs/scope-and-acceptance.md).
 *
 * The file itself goes to Supabase Storage. This validates the catalogue card
 * an administrator fills in about it.
 */

export const LEARNING_TOPICS = [
  'crop_production',
  'livestock',
  'pest_disease',
  'post_harvest',
  'marketing',
  'cooperative',
  'climate',
  'other',
] as const;

/** SHARED with crop_declaration: the five project crops, docs/data-model.md. */
export const CROPS = ['sorghum', 'groundnut', 'sesame', 'maize', 'cowpea'] as const;

/** SHARED with consent: the two interface languages, docs/data-model.md. */
export const LANGUAGES = ['en', 'ar'] as const;

export const RESOURCE_FORMATS = ['pdf', 'image', 'audio', 'video'] as const;

export const LEARNING_LIMITS = {
  titleMax: 200,
  descriptionMax: 2000,
  storagePathMax: 1024,
  /** 200 MB. Beyond that a file is not a field resource, it is a mistake. */
  byteSizeMax: 200 * 1024 * 1024,
} as const;

export const LEARNING_MESSAGES = {
  titleRequired: 'Enter a title.',
  titleBlank: 'A title cannot be only spaces.',
  titleTooLong: `A title has at most ${LEARNING_LIMITS.titleMax} characters.`,
  topicUnknown: 'Choose a topic from the list.',
  cropUnknown: 'A crop is sorghum, groundnut, sesame, maize or cowpea, or leave it empty.',
  languageUnknown: 'A resource is in English or Arabic.',
  formatUnknown: 'A resource is a PDF, an image, audio or video.',
  storagePathRequired: 'The uploaded file has no storage path.',
  storagePathShape:
    'A storage path is a relative path inside the bucket, with no leading slash or "..".',
  storagePathTooLong: `A storage path has at most ${LEARNING_LIMITS.storagePathMax} characters.`,
  byteSizeNotWhole: 'The file size must be a whole number of bytes.',
  byteSizeTooSmall: 'An empty file cannot be published.',
  byteSizeTooLarge:
    'A file larger than 200 MB cannot be offered to a phone on a metered connection.',
  descriptionTooLong: `A description has at most ${LEARNING_LIMITS.descriptionMax} characters.`,
} as const;

/**
 * A path inside the Storage bucket: segments of safe characters joined by
 * single slashes. No leading slash, no empty segment, no "." or "..", so a
 * path can never point outside the bucket or at a hidden object.
 */
const STORAGE_PATH = /^(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

// ---------------------------------------------------------------------------
// ADVICE & LEARNING: DRAFT, REVIEW, PUBLISH (2026-10-22)
// ---------------------------------------------------------------------------
//
// CORWADO's 16 October specification: "Advice and Learning: Draft, review and
// publication workflow; translations, media, topics and advisory requests.
// Publishing authority is separately assignable." and "Public visitors can
// browse published listings and advice."
//
// Still a library of guides, not a course system (CLAUDE.md section 2). The
// workflow is on the existing learning_resource row (migration
// 20261022100000_learning_workflow): a status, the shared advice topics, an
// Arabic title and summary beside the English ones, and who moved it when.

/** The four states of a guide. `published` is the only one the public sees. */
export const LEARNING_STATUSES = ['draft', 'in_review', 'published', 'unpublished'] as const;
export type LearningStatus = (typeof LEARNING_STATUSES)[number];

/** The four moves between them. Editing the card is not one of them. */
export const LEARNING_ACTIONS = ['submit', 'return', 'publish', 'unpublish'] as const;
export type LearningAction = (typeof LEARNING_ACTIONS)[number];

/**
 * Where each move may start and where it lands.
 *
 * - submit: a draft, or a guide taken down for correction, goes to review.
 * - return: a guide in review goes back to draft, with a note saying why.
 * - publish: a guide in review goes public; so does one that was unpublished,
 *   because putting back what a publisher took down needs no second review.
 * - unpublish: a published guide leaves the public pages. Nothing is deleted.
 */
export const LEARNING_TRANSITIONS: Readonly<
  Record<LearningAction, { readonly from: readonly LearningStatus[]; readonly to: LearningStatus }>
> = {
  submit: { from: ['draft', 'unpublished'], to: 'in_review' },
  return: { from: ['in_review'], to: 'draft' },
  publish: { from: ['in_review', 'unpublished'], to: 'published' },
  unpublish: { from: ['published'], to: 'unpublished' },
};

/** The status a move leads to from `from`, or null when the move is not open. */
export function learningTransition(
  from: LearningStatus,
  action: LearningAction,
): LearningStatus | null {
  const rule = LEARNING_TRANSITIONS[action];
  return rule.from.includes(from) ? rule.to : null;
}

/**
 * PUBLISHING AUTHORITY IS SEPARATELY ASSIGNABLE. Writing and submitting need
 * `content.moderate` or `content.publish`; returning, publishing and
 * unpublishing need `content.publish`. A guide that is in review or public can
 * be edited only by someone who could publish it, or an editor without that
 * authority could change public text that nobody approved.
 */
export const LEARNING_ACTION_NEEDS_PUBLISH: Readonly<Record<LearningAction, boolean>> = {
  submit: false,
  return: true,
  publish: true,
  unpublish: true,
};

export const learningEditNeedsPublish = (status: LearningStatus): boolean =>
  status === 'in_review' || status === 'published';

/**
 * The library's own shelves (LEARNING_TOPICS, migration 6) mapped onto the
 * shared ADVICE_TOPICS, both ways. The migration backfills `topics` with the
 * same mapping; the route uses the reverse to keep the old `topic` column
 * filled when a card is written with advice topics only.
 */
export const ADVICE_TOPIC_FOR_LEARNING_TOPIC: Readonly<Record<LearningTopic, AdviceTopic>> = {
  crop_production: 'crops',
  livestock: 'livestock',
  pest_disease: 'pests_diseases',
  post_harvest: 'post_harvest',
  marketing: 'marketing_prices',
  cooperative: 'finance_business',
  climate: 'climate_weather',
  other: 'other',
};

export const LEARNING_TOPIC_FOR_ADVICE_TOPIC: Readonly<Record<AdviceTopic, LearningTopic>> = {
  crops: 'crop_production',
  livestock: 'livestock',
  soil_fertiliser: 'crop_production',
  pests_diseases: 'pest_disease',
  water_irrigation: 'crop_production',
  post_harvest: 'post_harvest',
  marketing_prices: 'marketing',
  finance_business: 'cooperative',
  climate_weather: 'climate',
  other: 'other',
};

/** A guide has at most this many topics: enough to cross-file, few enough to mean something. */
export const LEARNING_TOPICS_MAX = 4;
/** A note sent back with a guide, and a search on the public page. */
export const LEARNING_NOTE_MIN = 5;
export const LEARNING_NOTE_MAX = 1000;
export const LEARNING_SEARCH_MAX = 100;

/**
 * Field reasons added with the workflow. Pinned in CONVENTIONS section 5.2.3
 * and checked by packages/shared/tests/conventions-match-code.test.ts.
 */
export const LEARNING_WORKFLOW_MESSAGES = {
  topicsRequired: 'Choose at least one topic.',
  topicsUnknown: 'Choose topics from the list.',
  topicsTooMany: `Choose at most ${LEARNING_TOPICS_MAX} topics.`,
  titleArTooLong: `An Arabic title has at most ${LEARNING_LIMITS.titleMax} characters.`,
  descriptionArTooLong: `An Arabic summary has at most ${LEARNING_LIMITS.descriptionMax} characters.`,
  actionUnknown: 'Choose submit, return, publish or unpublish.',
  noteRequired: `Say what needs to change, in at least ${LEARNING_NOTE_MIN} characters.`,
  noteTooLong: `Keep the note under ${LEARNING_NOTE_MAX} characters.`,
  noteNotExpected: 'Only a guide sent back to draft carries a note.',
  topicFilterUnknown: 'Choose a topic from the list, or leave it out.',
  languageFilterUnknown: 'Choose English or Arabic, or leave it out.',
  searchTooLong: `A search has at most ${LEARNING_SEARCH_MAX} characters.`,
} as const;

/** An optional translation: blank means "not translated", stored as null. */
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

export const learningResourceInputSchema = z
  .strictObject({
    title: z
      .string({ error: () => LEARNING_MESSAGES.titleRequired })
      .trim()
      .min(1, LEARNING_MESSAGES.titleBlank)
      .max(LEARNING_LIMITS.titleMax, LEARNING_MESSAGES.titleTooLong),
    /**
     * The library's own shelf. 2026-10-22: optional -- a card written with
     * `topics` only has it derived from the first one (LEARNING_TOPIC_FOR_ADVICE_TOPIC).
     * Still accepted, so a caller that sends only `topic` keeps working: its
     * `topics` is derived the other way.
     */
    topic: z.enum(LEARNING_TOPICS, { error: () => LEARNING_MESSAGES.topicUnknown }).optional(),
    /** 2026-10-22: the shared advice topics a farmer filters by. */
    topics: z
      .array(z.enum(ADVICE_TOPICS, { error: () => LEARNING_WORKFLOW_MESSAGES.topicsUnknown }), {
        error: () => LEARNING_WORKFLOW_MESSAGES.topicsUnknown,
      })
      .min(1, LEARNING_WORKFLOW_MESSAGES.topicsRequired)
      .max(LEARNING_TOPICS_MAX, LEARNING_WORKFLOW_MESSAGES.topicsTooMany)
      .transform((list) => [...new Set(list)])
      .optional(),
    /** 2026-10-22: the Arabic title and summary. `title` and `description` are the English. */
    title_ar: optionalText(LEARNING_LIMITS.titleMax, LEARNING_WORKFLOW_MESSAGES.titleArTooLong),
    description_ar: optionalText(
      LEARNING_LIMITS.descriptionMax,
      LEARNING_WORKFLOW_MESSAGES.descriptionArTooLong,
    ),
    crop: z
      .enum(CROPS, { error: () => LEARNING_MESSAGES.cropUnknown })
      .nullable()
      .optional(),
    language: z.enum(LANGUAGES, { error: () => LEARNING_MESSAGES.languageUnknown }),
    format: z.enum(RESOURCE_FORMATS, { error: () => LEARNING_MESSAGES.formatUnknown }),
    storage_path: z
      .string({ error: () => LEARNING_MESSAGES.storagePathRequired })
      .trim()
      .min(1, LEARNING_MESSAGES.storagePathRequired)
      .max(LEARNING_LIMITS.storagePathMax, LEARNING_MESSAGES.storagePathTooLong)
      .regex(STORAGE_PATH, LEARNING_MESSAGES.storagePathShape),
    byte_size: z
      .number({ error: () => LEARNING_MESSAGES.byteSizeNotWhole })
      .int(LEARNING_MESSAGES.byteSizeNotWhole)
      .min(1, LEARNING_MESSAGES.byteSizeTooSmall)
      .max(LEARNING_LIMITS.byteSizeMax, LEARNING_MESSAGES.byteSizeTooLarge),
    description: z
      .string()
      .trim()
      .max(LEARNING_LIMITS.descriptionMax, LEARNING_MESSAGES.descriptionTooLong)
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional(),
    // 2026-10-22: `published` is no longer sent with the card. A guide goes
    // public only through the publish move (learningTransitionSchema), which
    // needs publishing authority; a card that could set it would bypass that.
  })
  .superRefine((value, ctx) => {
    if (value.topic === undefined && value.topics === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['topics'],
        message: LEARNING_WORKFLOW_MESSAGES.topicsRequired,
      });
    }
  });

/** POST /api/learning-resources/:id/transition. A note only with `return`, and then required. */
export const learningTransitionSchema = z
  .strictObject({
    action: z.enum(LEARNING_ACTIONS, { error: () => LEARNING_WORKFLOW_MESSAGES.actionUnknown }),
    note: z
      .string({ error: () => LEARNING_WORKFLOW_MESSAGES.noteRequired })
      .trim()
      .max(LEARNING_NOTE_MAX, LEARNING_WORKFLOW_MESSAGES.noteTooLong)
      .optional(),
  })
  .superRefine((value, ctx) => {
    const note = value.note ?? '';
    if (value.action === 'return' && note.length < LEARNING_NOTE_MIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: LEARNING_WORKFLOW_MESSAGES.noteRequired,
      });
    }
    if (value.action !== 'return' && note !== '') {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: LEARNING_WORKFLOW_MESSAGES.noteNotExpected,
      });
    }
  });

/**
 * GET /api/guides, the public list. Every filter optional; query strings are
 * text, so `limit` and `cursor` are checked by the route as everywhere else.
 */
export const publicGuideFilterSchema = z.strictObject({
  topic: z
    .enum(ADVICE_TOPICS, { error: () => LEARNING_WORKFLOW_MESSAGES.topicFilterUnknown })
    .optional(),
  language: z
    .enum(LANGUAGES, { error: () => LEARNING_WORKFLOW_MESSAGES.languageFilterUnknown })
    .optional(),
  q: z
    .string()
    .trim()
    .max(LEARNING_SEARCH_MAX, LEARNING_WORKFLOW_MESSAGES.searchTooLong)
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

/** Where the guides' files live. Private: a file is reached through a read link that expires. */
export const LEARNING_RESOURCE_BUCKET = 'learning-resources';
/** How long a public read link to a published guide's file lives. */
export const LEARNING_READ_LINK_SECONDS = 600;

export type LearningTransitionInput = z.infer<typeof learningTransitionSchema>;
export type PublicGuideFilter = z.infer<typeof publicGuideFilterSchema>;

export type LearningTopic = (typeof LEARNING_TOPICS)[number];
export type Crop = (typeof CROPS)[number];
export type Language = (typeof LANGUAGES)[number];
export type ResourceFormat = (typeof RESOURCE_FORMATS)[number];
export type LearningResourceInput = z.infer<typeof learningResourceInputSchema>;
