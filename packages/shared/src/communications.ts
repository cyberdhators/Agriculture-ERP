import { z } from 'zod';

/**
 * ADMINISTRATOR COMMUNICATIONS — THE CONTRACT, AHEAD OF THE ROUTE.
 *
 * Proposed 2026-09-17 and approved by the developers as an addition to scope.
 * The screens are built against this; the routes are built to it. Nothing here
 * sends anything: there is no provider integration in this repository, no
 * `RESEND_API_KEY`, and no send route. The schema exists so that the composer
 * and the future route cannot disagree about what a valid message is — the
 * same arrangement every other unit in this system uses.
 *
 * WHY EMAIL AND SMS ARE NOT ONE SHAPE. They differ in the only way that
 * matters: who can receive them.
 *
 *   - EMAIL reaches STAFF, because a staff account is created with an email
 *     address and signs in with it.
 *   - EMAIL CANNOT REACH FARMERS OR OFFICERS. Neither table has an email
 *     column. An officer's `officer.<digits>@officers.invalid` identifier is
 *     NOT an address — `.invalid` is reserved by RFC 2606 precisely so that
 *     nothing can ever be delivered to it — and it must never be displayed or
 *     treated as one.
 *   - SMS is the contracted channel for a farmer (deliverable (n)), and is the
 *     reason Bird replaced Africa's Talking, who do not serve South Sudan.
 *
 * So the recipient type is part of the channel, not a free choice beside it.
 */

/** Who a message can be addressed to. Extensible without a rewrite. */
export const COMMUNICATION_CHANNELS = ['email', 'sms'] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const RECIPIENT_TYPES = ['staff', 'officer', 'farmer'] as const;
export type RecipientType = (typeof RECIPIENT_TYPES)[number];

/**
 * Which recipient types each channel can actually reach TODAY.
 *
 * `farmer` and `officer` are absent from `email` because the columns do not
 * exist, not because of a policy. If the owner adds an optional email column to
 * either table (see the 17 September position paper), this list is where that
 * decision becomes visible to every screen at once.
 */
export const CHANNEL_RECIPIENTS: Record<CommunicationChannel, readonly RecipientType[]> = {
  email: ['staff'],
  sms: ['farmer', 'officer'],
};

export const COMMUNICATION_LIMITS = {
  subjectMax: 200,
  /** Generous for email; SMS is bounded by the provider and by cost, not here. */
  bodyMax: 5000,
  /** One send addresses at most this many recipients, so a mistake is bounded. */
  recipientsMax: 500,
} as const;

export const COMMUNICATION_MESSAGES = {
  channelUnknown: 'Choose email or SMS.',
  recipientTypeUnsupported: 'That kind of recipient cannot be reached on this channel.',
  recipientsRequired: 'Choose at least one recipient.',
  recipientsTooMany: `A single message reaches at most ${COMMUNICATION_LIMITS.recipientsMax} recipients.`,
  recipientNotUuid: 'A recipient is identified by its record id.',
  subjectRequired: 'Enter a subject.',
  subjectTooLong: `A subject has at most ${COMMUNICATION_LIMITS.subjectMax} characters.`,
  bodyRequired: 'Enter a message.',
  bodyTooLong: `A message has at most ${COMMUNICATION_LIMITS.bodyMax} characters.`,
  subjectNotForSms: 'An SMS has no subject.',
} as const;

const uuid = (message: string) =>
  z
    .string({ error: () => message })
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, message);

/**
 * `POST /api/admin/communications` — PROPOSED, not yet implemented.
 *
 * Recipients are sent as RECORD IDS, never as addresses or phone numbers. The
 * server resolves each id to a contact itself, which means a browser never
 * carries a list of people's addresses, an address cannot be substituted in
 * flight, and a recipient the caller may not see is refused by scope rather
 * than by the client's good manners.
 */
export const sendCommunicationSchema = z
  .strictObject({
    channel: z.enum(COMMUNICATION_CHANNELS, {
      error: () => COMMUNICATION_MESSAGES.channelUnknown,
    }),
    recipient_type: z.enum(RECIPIENT_TYPES, {
      error: () => COMMUNICATION_MESSAGES.recipientTypeUnsupported,
    }),
    recipient_ids: z
      .array(uuid(COMMUNICATION_MESSAGES.recipientNotUuid), {
        error: () => COMMUNICATION_MESSAGES.recipientsRequired,
      })
      .min(1, COMMUNICATION_MESSAGES.recipientsRequired)
      .max(COMMUNICATION_LIMITS.recipientsMax, COMMUNICATION_MESSAGES.recipientsTooMany),
    subject: z
      .string({ error: () => COMMUNICATION_MESSAGES.subjectRequired })
      .trim()
      .max(COMMUNICATION_LIMITS.subjectMax, COMMUNICATION_MESSAGES.subjectTooLong)
      .optional(),
    body: z
      .string({ error: () => COMMUNICATION_MESSAGES.bodyRequired })
      .trim()
      .min(1, COMMUNICATION_MESSAGES.bodyRequired)
      .max(COMMUNICATION_LIMITS.bodyMax, COMMUNICATION_MESSAGES.bodyTooLong),
  })
  .superRefine((value, ctx) => {
    // The channel decides who can be addressed. Sending email to a farmer is
    // not a permission question — there is no address to send it to.
    if (!CHANNEL_RECIPIENTS[value.channel].includes(value.recipient_type)) {
      ctx.addIssue({
        code: 'custom',
        path: ['recipient_type'],
        message: COMMUNICATION_MESSAGES.recipientTypeUnsupported,
      });
    }
    if (value.channel === 'email' && (value.subject === undefined || value.subject === '')) {
      ctx.addIssue({
        code: 'custom',
        path: ['subject'],
        message: COMMUNICATION_MESSAGES.subjectRequired,
      });
    }
    if (value.channel === 'sms' && value.subject) {
      ctx.addIssue({
        code: 'custom',
        path: ['subject'],
        message: COMMUNICATION_MESSAGES.subjectNotForSms,
      });
    }
  });

export type SendCommunication = z.infer<typeof sendCommunicationSchema>;

/**
 * What the route answers — PROPOSED.
 *
 * `accepted` is what the PROVIDER took, not what a person received. Delivery is
 * a later event the provider reports separately, and a screen must not turn
 * "accepted" into "delivered". `unreachable` counts recipients the server could
 * not address at all — a staff account with no email, a farmer with no phone —
 * and is reported rather than silently dropped.
 */
export interface CommunicationResult {
  id: string;
  channel: CommunicationChannel;
  recipient_type: RecipientType;
  requested: number;
  accepted: number;
  unreachable: number;
  failed: number;
  sent_at: string;
}
