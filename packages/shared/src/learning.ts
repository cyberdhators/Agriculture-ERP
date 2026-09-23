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
export const LANGUAGES = ['en', 'ar-juba'] as const;

export const RESOURCE_FORMATS = ['pdf', 'image', 'audio', 'video'] as const;

export const LEARNING_LIMITS = {
  titleMax: 200,
  descriptionMax: 2000,
  storagePathMax: 1024,
  /** 200 MB. Beyond that a file is not a field resource, it is a mistake. */
  byteSizeMax: 200 * 1024 * 1024,
  /** Our expiry on an upload grant, as C-8.8 sets for attachments. */
  grantMinutes: 15,
  /** A read link lives this long. Long enough to open, short enough to matter. */
  readLinkSeconds: 300,
} as const;

/** The bucket. Private, no public policy; one server module issues grants. */
export const LEARNING_RESOURCE_BUCKET = 'learning-resources';

/**
 * What each format may actually be. `format` is the word an officer reads;
 * the content type is what the provider enforces at upload and what decides
 * the stored object's extension.
 */
export const RESOURCE_CONTENT_TYPES = {
  pdf: ['application/pdf'],
  image: ['image/jpeg', 'image/png', 'image/webp'],
  audio: ['audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/ogg', 'audio/webm'],
  video: ['video/mp4', 'video/webm'],
} as const satisfies Record<ResourceFormat, readonly string[]>;

const RESOURCE_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'weba',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/**
 * THE SERVER'S PATH FOR A RESOURCE, FROM ITS ID -- NEVER FROM THE CLIENT.
 *
 * A caller that could name the path could name any path, and would be choosing
 * which object in the bucket a catalogue row points at. The id is the only
 * thing the client supplies to anything here, and the id is what the path is
 * made of, so one row can only ever address one object.
 */
export const learningStoragePath = (resourceId: string, contentType: string): string =>
  `resources/${resourceId}.${RESOURCE_EXTENSIONS[contentType] ?? 'bin'}`;

export const LEARNING_MESSAGES = {
  titleRequired: 'Enter a title.',
  titleBlank: 'A title cannot be only spaces.',
  titleTooLong: `A title has at most ${LEARNING_LIMITS.titleMax} characters.`,
  topicUnknown: 'Choose a topic from the list.',
  cropUnknown: 'A crop is sorghum, groundnut, sesame, maize or cowpea, or leave it empty.',
  languageUnknown: 'A resource is in English or Arabi Juba.',
  formatUnknown: 'A resource is a PDF, an image, audio or video.',
  storagePathRequired: 'The uploaded file has no storage path.',
  storagePathShape:
    'A storage path is a relative path inside the bucket, with no leading slash or "..".',
  contentTypeUnknown: 'Say what kind of file this is.',
  contentTypeMismatch: 'The file type does not match the format chosen for this resource.',
  fileMissing: 'The file has not reached the store yet, so this cannot be published.',
  fileMismatch: 'The file in the store is not the one this resource describes.',
  byteSizeNotWhole: 'The file size must be a whole number of bytes.',
  byteSizeTooSmall: 'An empty file cannot be published.',
  byteSizeTooLarge:
    'A file larger than 200 MB cannot be offered to a phone on a metered connection.',
  descriptionTooLong: `A description has at most ${LEARNING_LIMITS.descriptionMax} characters.`,
} as const;

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

/**
 * REGISTERING A RESOURCE: the card, plus what KIND of file is coming.
 *
 * The caller says what the file IS, never where it will live. The server
 * derives the path from the id it minted (`learningStoragePath`), so a
 * catalogue row addresses exactly one object and a caller cannot point a row
 * at somebody else's file. The old schema took a `storage_path` string from
 * the client, which is precisely that hazard.
 *
 * The content type must match the declared format, so a row labelled "audio"
 * cannot be carrying a PDF.
 */
export const createLearningResourceSchema = learningResourceInputSchema
  .extend({
    content_type: z
      .string({ error: () => LEARNING_MESSAGES.contentTypeUnknown })
      .trim()
      .toLowerCase(),
  })
  .superRefine((body, ctx) => {
    const allowed: readonly string[] = RESOURCE_CONTENT_TYPES[body.format];
    if (!allowed.includes(body.content_type)) {
      ctx.addIssue({
        code: 'custom',
        path: ['content_type'],
        message: LEARNING_MESSAGES.contentTypeMismatch,
      });
    }
  });
export type CreateLearningResource = z.infer<typeof createLearningResourceSchema>;
export type LearningResourceInput = z.infer<typeof learningResourceInputSchema>;
