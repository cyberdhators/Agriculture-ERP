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
} as const;

export const ASSISTANT_LANGUAGES = ['en', 'ar'] as const;

export const ASSISTANT_MESSAGES = {
  questionRequired: 'Type a question.',
  questionTooLong: `A question can be at most ${ASSISTANT_LIMITS.messageMax} characters.`,
  historyInvalid: 'The conversation could not be read. Start a new one.',
  languageInvalid: 'Choose English or Arabic.',
} as const;

const turnSchema = z.discriminatedUnion(
  'role',
  [
    z.strictObject({
      role: z.literal('user'),
      content: z
        .string({ error: () => ASSISTANT_MESSAGES.questionRequired })
        .trim()
        .min(1, ASSISTANT_MESSAGES.questionRequired)
        .max(ASSISTANT_LIMITS.messageMax, ASSISTANT_MESSAGES.questionTooLong),
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
    }),
  language: z
    .enum(ASSISTANT_LANGUAGES, { error: () => ASSISTANT_MESSAGES.languageInvalid })
    .default('en'),
});

export type AssistantRequest = z.infer<typeof assistantRequestSchema>;
export type AssistantRequestInput = z.input<typeof assistantRequestSchema>;
