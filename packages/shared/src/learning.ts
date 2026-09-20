import { z } from 'zod';

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

export const learningResourceInputSchema = z.strictObject({
  title: z
    .string({ error: () => LEARNING_MESSAGES.titleRequired })
    .trim()
    .min(1, LEARNING_MESSAGES.titleBlank)
    .max(LEARNING_LIMITS.titleMax, LEARNING_MESSAGES.titleTooLong),
  topic: z.enum(LEARNING_TOPICS, { error: () => LEARNING_MESSAGES.topicUnknown }),
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
  published: z.boolean().default(false),
});

export type LearningTopic = (typeof LEARNING_TOPICS)[number];
export type Crop = (typeof CROPS)[number];
export type Language = (typeof LANGUAGES)[number];
export type ResourceFormat = (typeof RESOURCE_FORMATS)[number];
export type LearningResourceInput = z.infer<typeof learningResourceInputSchema>;
