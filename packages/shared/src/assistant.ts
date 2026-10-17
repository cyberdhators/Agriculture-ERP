import { z } from 'zod';

/**
 * THE FARMER'S ASSISTANT (2026-10-17). The owner approved an AI chat in place
 * of the learning library on the farmer's dashboard ("Ask AI", lifted from
 * CLAUDE.md's hold list), answered by Claude Haiku 5.5. The conversation is
 * kept on the farmer's phone; each request carries the recent turns.
 */

export const ASSISTANT_LIMITS = {
  /** One question, in characters. */
  messageMax: 1000,
  /** Turns sent with a question (questions and answers together). */
  historyMax: 20,
  /** An earlier answer, as sent back with a new question. */
  replyMax: 6000,
  /** Questions per farmer per day (UTC), so a loop or a shared phone cannot run up the bill. */
  dailyMax: 30,
  /**
   * One photo, base64, as the phone sends it after shrinking it to about 1024
   * pixels (2026-10-17). ~450 KB of image, well inside the 1 MB body limit.
   */
  imageMaxChars: 600_000,
} as const;

/** What a phone's photo is sent as: the formats the model reads. */
export const ASSISTANT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const ASSISTANT_LANGUAGES = ['en', 'ar'] as const;

export const ASSISTANT_MESSAGES = {
  questionRequired: 'Type a question.',
  questionTooLong: `A question can be at most ${ASSISTANT_LIMITS.messageMax} characters.`,
  historyInvalid: 'The conversation could not be read. Start a new one.',
  languageInvalid: 'Choose English or Arabic.',
  imageInvalid: 'The photo could not be read. Take it again.',
  imageTooLarge: 'The photo is too large. Take it again.',
  imageOnlyLast: 'Only the newest question can carry a photo.',
} as const;

const imageSchema = z.strictObject(
  {
    media_type: z.enum(ASSISTANT_IMAGE_TYPES, { error: () => ASSISTANT_MESSAGES.imageInvalid }),
    data: z
      .string({ error: () => ASSISTANT_MESSAGES.imageInvalid })
      .max(ASSISTANT_LIMITS.imageMaxChars, ASSISTANT_MESSAGES.imageTooLarge)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, ASSISTANT_MESSAGES.imageInvalid),
  },
  { error: () => ASSISTANT_MESSAGES.imageInvalid },
);

const turnSchema = z.discriminatedUnion(
  'role',
  [
    z
      .strictObject({
        role: z.literal('user'),
        content: z
          .string({ error: () => ASSISTANT_MESSAGES.questionRequired })
          .trim()
          .max(ASSISTANT_LIMITS.messageMax, ASSISTANT_MESSAGES.questionTooLong),
        /** 2026-10-17: a photo of the crop, pest, grain or animal. */
        image: imageSchema.optional(),
      })
      // A question needs words, or a photo to ask about.
      .refine((turn) => turn.content.length > 0 || turn.image !== undefined, {
        message: ASSISTANT_MESSAGES.questionRequired,
        path: ['content'],
      }),
    z.strictObject({
      role: z.literal('assistant'),
      content: z.string().max(ASSISTANT_LIMITS.replyMax, ASSISTANT_MESSAGES.historyInvalid),
    }),
  ],
  { error: () => ASSISTANT_MESSAGES.historyInvalid },
);

/** The conversation so far, ending with the farmer's new question. */
export const assistantRequestSchema = z.strictObject({
  messages: z
    .array(turnSchema, { error: () => ASSISTANT_MESSAGES.historyInvalid })
    .min(1, ASSISTANT_MESSAGES.questionRequired)
    .max(ASSISTANT_LIMITS.historyMax, ASSISTANT_MESSAGES.historyInvalid)
    .refine((list) => list[list.length - 1]?.role === 'user', {
      message: ASSISTANT_MESSAGES.questionRequired,
    })
    .refine((list) => list.every((t, i) => i === 0 || t.role !== list[i - 1]!.role), {
      message: ASSISTANT_MESSAGES.historyInvalid,
    })
    // Earlier photos are never sent again: they would cost the farmer's data
    // and the tokens a second time for an answer already given.
    .refine((list) => list.every((t, i) => i === list.length - 1 || !('image' in t && t.image)), {
      message: ASSISTANT_MESSAGES.imageOnlyLast,
    }),
  language: z
    .enum(ASSISTANT_LANGUAGES, { error: () => ASSISTANT_MESSAGES.languageInvalid })
    .default('en'),
});

export type AssistantRequest = z.infer<typeof assistantRequestSchema>;
export type AssistantRequestInput = z.input<typeof assistantRequestSchema>;
