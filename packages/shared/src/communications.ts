import { z } from 'zod';

import { FARMER_MESSAGES, VERIFICATION_STATUSES } from './farmer';

/**
 * ADMINISTRATOR COMMUNICATIONS — THE CONTRACT, AHEAD OF THE ROUTE.
 *
 * Proposed 2026-09-17 and approved by the developers as an addition to scope.
 * The screens are built against this; the routes are built to it. Nothing here
 * sends anything: email goes out through `apps/web/lib/email/resend.ts` and,
 * since 2026-10-10, SMS through `apps/web/lib/sms/bird.ts`, both called only by
 * `POST /api/admin/communications`. The schema exists so that the composer and
 * the route cannot disagree about what a valid message is — the same
 * arrangement every other unit in this system uses.
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
  /** Generous for email. An SMS is bounded by `smsSegmentsMax` below as well. */
  bodyMax: 5000,
  /** One send addresses at most this many recipients, so a mistake is bounded. */
  recipientsMax: 500,
  /**
   * An SMS is billed per SEGMENT, per recipient, so its length is a cost and
   * is capped here rather than left to the provider. Three segments is 459
   * characters of plain Latin text, or 201 once a single character needs
   * Unicode (Arabic script, curly quotes, most emoji). See `smsLength`.
   */
  smsSegmentsMax: 3,
  /** The free-text search in the farmer picker. */
  searchMax: 100,
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
  smsTooLong: `An SMS can be at most ${COMMUNICATION_LIMITS.smsSegmentsMax} parts: 459 plain characters, or 201 with Arabic or special ones.`,
  searchTooLong: `A search can be at most ${COMMUNICATION_LIMITS.searchMax} characters.`,
  locationInvalid: 'Choose a location from the list.',
  selectInvalid: 'Choose ids, or leave the selection mode out.',
} as const;

/**
 * HOW LONG AN SMS IS, IN THE UNIT IT IS BILLED IN.
 *
 * A message is sent in GSM-7 when every character is in the GSM 03.38 table,
 * and in UCS-2 otherwise. One GSM-7 segment holds 160 characters (153 each once
 * the message concatenates); one UCS-2 segment holds 70 (67 each). A character
 * from the GSM-7 extension table (^ { } \ [ ~ ] | € and form feed) takes two
 * places. A UCS-2 length is counted in UTF-16 code units, so an emoji outside
 * the Basic Multilingual Plane takes two.
 *
 * The same function runs in the composer (the counter the administrator sees)
 * and in the schema the route validates with, so the two cannot disagree. The
 * provider's own count is the authority on the invoice; this is the arithmetic
 * that keeps a send from surprising anyone.
 */
const GSM7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const GSM7_EXTENDED = new Set('^{}\\[~]|€\f');

export type SmsEncoding = 'gsm7' | 'ucs2';

export interface SmsLength {
  encoding: SmsEncoding;
  /** Places used: GSM-7 septets, or UCS-2 code units. */
  units: number;
  segments: number;
  /** Places available in one segment at the current segment count. */
  perSegment: number;
}

export function smsLength(text: string): SmsLength {
  let gsmUnits = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM7_BASIC.has(ch)) gsmUnits += 1;
    else if (GSM7_EXTENDED.has(ch)) gsmUnits += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    const segments = gsmUnits === 0 ? 0 : gsmUnits <= 160 ? 1 : Math.ceil(gsmUnits / 153);
    return { encoding: 'gsm7', units: gsmUnits, segments, perSegment: segments > 1 ? 153 : 160 };
  }
  const units = text.length;
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  return { encoding: 'ucs2', units, segments, perSegment: segments > 1 ? 67 : 70 };
}

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
    // Every segment is billed for every recipient, so the cap is on segments,
    // checked on the trimmed text, which is what is sent.
    if (
      value.channel === 'sms' &&
      smsLength(value.body).segments > COMMUNICATION_LIMITS.smsSegmentsMax
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: COMMUNICATION_MESSAGES.smsTooLong,
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

/**
 * `GET /api/admin/communications/farmers` — the farmer picker behind the SMS
 * composer. Administrator only.
 *
 * Its own schema and its own route, deliberately apart from `GET /api/farmers`:
 * the picker needs a free-text search and a "select every match" mode, and it
 * must never return a phone number. A search may MATCH on a phone number —
 * the administrator types digits they were given — but the answer carries ids,
 * names and places only.
 *
 * `select=ids` answers with every REACHABLE matching id (up to the per-message
 * cap) instead of a page, which is how "select all matching" works without the
 * browser paging through the register.
 */
const locationId = z
  .string({ error: () => COMMUNICATION_MESSAGES.locationInvalid })
  .trim()
  .regex(/^[A-Za-z0-9-]{1,32}$/, COMMUNICATION_MESSAGES.locationInvalid);

export const communicationFarmerFilterSchema = z.strictObject({
  q: z
    .string({ error: () => COMMUNICATION_MESSAGES.searchTooLong })
    .trim()
    .max(COMMUNICATION_LIMITS.searchMax, COMMUNICATION_MESSAGES.searchTooLong)
    .optional(),
  state: locationId.optional(),
  county: locationId.optional(),
  payam: locationId.optional(),
  verification_status: z
    .enum(VERIFICATION_STATUSES, { error: () => FARMER_MESSAGES.filterStatusInvalid })
    .optional(),
  select: z.enum(['ids'], { error: () => COMMUNICATION_MESSAGES.selectInvalid }).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

export type CommunicationFarmerFilter = z.infer<typeof communicationFarmerFilterSchema>;

/** One row of the picker. No phone number, ever. */
export interface CommunicationFarmer {
  id: string;
  farmer_number: string;
  name: string;
  state_id: string;
  county_id: string;
  payam_id: string;
  verification_status: string;
  /**
   * False when an SMS could not be sent to this farmer: their consent is
   * withdrawn, or the stored number is not a South Sudan mobile. Shown, not
   * hidden, so an administrator can see why someone cannot be ticked.
   */
  reachable: boolean;
}

/** The answer to `select=ids`. */
export interface CommunicationFarmerIds {
  ids: string[];
  /** Every reachable match, which may exceed `ids.length` when capped. */
  total: number;
  /** True when more matched than one message may address. */
  capped: boolean;
}
