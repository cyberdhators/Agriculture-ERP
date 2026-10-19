import { z } from 'zod';

import { buyerEmailSchema } from './buyer';
import { phoneSchema } from './phone';

/**
 * "CONTACT CORWADO" (2026-10-21). The owner's choice: a help page with FAQs
 * and a short message form; staff see the messages in a list and mark them
 * done. No tickets, no assignment, no replies, no SLAs -- helpdesk ticketing
 * is out of scope (CLAUDE.md section 2), so there are two statuses and no
 * more.
 *
 * A visitor (no sign-in) must leave a phone or an email. That is checked by
 * the route, which is the only place that knows whether a session exists.
 */

export const SUPPORT_TOPICS = ['account', 'marketplace', 'messages', 'technical', 'other'] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export const SUPPORT_STATUSES = ['new', 'done'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** Lengths; the database checks the same ones. */
export const SUPPORT_LIMITS = { nameMin: 2, nameMax: 120, bodyMin: 10, bodyMax: 2000 } as const;

/** Messages one sender may send in a day: the brake on a flooded inbox. */
export const SUPPORT_MESSAGES_PER_DAY = 5;

// Each pinned in docs/api/CONVENTIONS.md §5.2.3
export const SUPPORT_MESSAGES = {
  nameLength: 'Give your name, 2 to 120 characters.',
  topicUnknown: 'Choose account, marketplace, messages, technical or other.',
  bodyLength: 'Write your message, 10 to 2000 characters.',
  statusUnknown: 'Choose new or done.',
  doneOnly: 'A message can only be marked done.',
} as const;

const S = SUPPORT_MESSAGES;

/** The help-page form. Blank optional fields are left out, not sent empty. */
export const supportMessageSchema = z.strictObject({
  name: z
    .string({ error: () => S.nameLength })
    .trim()
    .min(SUPPORT_LIMITS.nameMin, S.nameLength)
    .max(SUPPORT_LIMITS.nameMax, S.nameLength),
  phone: phoneSchema.optional(),
  email: buyerEmailSchema.optional(),
  topic: z.enum(SUPPORT_TOPICS, { error: () => S.topicUnknown }),
  body: z
    .string({ error: () => S.bodyLength })
    .trim()
    .min(SUPPORT_LIMITS.bodyMin, S.bodyLength)
    .max(SUPPORT_LIMITS.bodyMax, S.bodyLength),
});
export type SupportMessageInput = z.infer<typeof supportMessageSchema>;

/** The staff list's query string. */
export const supportFilterSchema = z.strictObject({
  status: z.enum(SUPPORT_STATUSES, { error: () => S.statusUnknown }).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});
export type SupportFilter = z.infer<typeof supportFilterSchema>;

/** Marking one message done: the only change staff can make. */
export const supportDoneSchema = z.strictObject({
  status: z.literal('done', { error: () => S.doneOnly }),
});
export type SupportDoneInput = z.infer<typeof supportDoneSchema>;

/** One message as the staff list shows it. */
export interface SupportMessage {
  id: string;
  from_kind: 'farmer' | 'buyer' | 'visitor';
  name: string;
  phone: string | null;
  email: string | null;
  topic: SupportTopic;
  body: string;
  status: SupportStatus;
  handled_at: string | null;
  created_at: string;
}
