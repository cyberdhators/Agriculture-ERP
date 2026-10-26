import { z } from 'zod';

import { ACTIVITIES } from './account-profile';
import { smsLength } from './communications';
import { locationCodeSchema } from './location';

/**
 * OFFICIAL ANNOUNCEMENTS, MESSAGE TEMPLATES AND NOTIFICATION PREFERENCES
 * (2026-10-27). CORWADO's 16 October specification, the Communications tab:
 * "Official announcements, templates, recipient scope, preferences and
 * delivery records. Preview before sending; private conversations are not a
 * broadcast resource." docs/DECISIONS.md, "Official announcements".
 *
 * Everything in this file is pure: the lists, the schemas, the placeholder
 * renderer, the preference rule and the delivery tallies. The routes ask them;
 * the tests ask them directly, with no database and no provider.
 *
 * RECIPIENTS ARE CHOSEN BY SCOPE, NEVER BY A LIST A BROWSER SENDS, and the
 * scope is resolved on the server from the account tables only. Nothing here,
 * and nothing in the route, reads a conversation or a message: a private
 * conversation is not a broadcast resource.
 */

// ---------------------------------------------------------------------------
// LISTS -- each mirrors a CHECK in migration 20261027110000
// ---------------------------------------------------------------------------

export const ANNOUNCEMENT_CHANNELS = ['in_app', 'sms', 'email'] as const;
export type AnnouncementChannel = (typeof ANNOUNCEMENT_CHANNELS)[number];

/**
 * `announcement` respects each person's preferences. `essential` is for
 * account, security and service-continuity messages and is sent whatever the
 * preferences say -- the one kind a person cannot switch off.
 */
export const ANNOUNCEMENT_CATEGORIES = ['announcement', 'essential'] as const;
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

/**
 * Who an announcement reaches. Accounts are farmers and buyer accounts (one
 * account counted once, however many activities it has); staff and extension
 * officers are scopes of their own.
 */
export const ANNOUNCEMENT_SCOPES = [
  'all',
  'phone',
  'email',
  'state',
  'activity',
  'staff',
  'officers',
] as const;
export type AnnouncementScopeKind = (typeof ANNOUNCEMENT_SCOPES)[number];

export const ANNOUNCEMENT_SCOPE_LABELS: Readonly<Record<AnnouncementScopeKind, string>> = {
  all: 'All accounts',
  phone: 'Accounts that sign in with a phone number (farmers)',
  email: 'Accounts that sign in with an email address (buyers and organisations)',
  state: 'Accounts in one state',
  activity: 'Accounts by activity (actor type)',
  staff: 'Staff (email only)',
  officers: 'Extension officers (SMS only)',
};

export const ANNOUNCEMENT_STATUSES = ['draft', 'sending', 'completed'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const DELIVERY_STATUSES = ['queued', 'sending', 'sent', 'failed', 'skipped'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Why a delivery was not attempted. */
export const DELIVERY_SKIP_REASONS = [
  'preference',
  'no_contact',
  'duplicate_contact',
  'no_inbox',
] as const;
export type DeliverySkipReason = (typeof DELIVERY_SKIP_REASONS)[number];

export const DELIVERY_SKIP_LABELS: Readonly<Record<DeliverySkipReason, string>> = {
  preference: 'Turned off by the person',
  no_contact: 'No address or South Sudan mobile for this channel',
  duplicate_contact: 'Same phone as another recipient: sent once',
  no_inbox: 'No in-app inbox (staff or officer)',
};

export const RECIPIENT_KINDS = ['farmer', 'buyer', 'officer', 'staff'] as const;
export type RecipientKind = (typeof RECIPIENT_KINDS)[number];

export const TEMPLATE_STATUSES = ['draft', 'active', 'archived'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const ANNOUNCEMENT_LIMITS = {
  templateNameMin: 3,
  templateNameMax: 80,
  titleMin: 3,
  titleMax: 120,
  bodyMin: 1,
  bodyMax: 2000,
  /** An SMS is billed per segment per recipient: three at most, as for direct SMS. */
  smsSegmentsMax: 3,
  /** A name placed into a message is cut to this many characters. */
  nameInMessageMax: 20,
  /**
   * External deliveries (SMS, email) attempted by one request. Small enough
   * that one request finishes well inside a serverless function's limit even
   * when the provider is slow (10 seconds per call, 8 at a time).
   */
  chunkSize: 40,
  /** A delivery claimed this long ago and never finished is reported, never resent. */
  staleSendingMinutes: 10,
  listMax: 50,
  deliveriesPageMax: 100,
} as const;

const L = ANNOUNCEMENT_LIMITS;

// ---------------------------------------------------------------------------
// MESSAGES -- each pinned in docs/api/CONVENTIONS.md §5.2.3
// ---------------------------------------------------------------------------

export const ANNOUNCEMENT_MESSAGES = {
  templateNameInvalid: 'Give the template a name of 3 to 80 characters.',
  channelUnknown: 'Choose in-app, SMS or email.',
  channelsRequired: 'Choose at least one channel.',
  titleInvalid: 'Give a title of 3 to 120 characters.',
  titleNotForSms: 'An SMS template has no title.',
  bodyInvalid: 'Write the message in 1 to 2000 characters.',
  smsBodyRequired: 'Write the SMS text, or untick SMS.',
  smsTooLong:
    'An SMS can be at most 3 parts: 459 plain characters, or 201 with Arabic or special ones.',
  placeholderUnknown: 'Use only the placeholders {name} and {service_name}.',
  templateStatusUnknown: 'Choose draft, active or archived.',
  templateEditEmpty: 'Change something before saving.',
  categoryUnknown: 'Choose announcement or essential.',
  scopeUnknown:
    'Choose all accounts, phone accounts, email accounts, a state, an activity, staff or officers.',
  scopeStateRequired: 'Choose the state.',
  scopeActivityRequired: 'Choose the activity.',
  scopeExtraField: 'Only a state scope has a state, and only an activity scope has an activity.',
  staffEmailOnly: 'Staff are reached by email only: choose email.',
  officersSmsOnly: 'Extension officers are reached by SMS only: choose SMS.',
  templateIdInvalid: 'Choose a template from the list.',
  confirmRequired: 'Tick the confirmation before sending.',
  expectedRecipientsInvalid: 'Send the recipient count the preview showed, as a whole number.',
  preferenceInvalid: 'Choose on or off.',
  deliveryFilterInvalid: 'Choose a channel and a status from the lists.',
} as const;

const M = ANNOUNCEMENT_MESSAGES;

// ---------------------------------------------------------------------------
// PLACEHOLDERS
// ---------------------------------------------------------------------------

/** The only placeholders a message may carry. Anything else in braces is refused. */
export const MESSAGE_PLACEHOLDERS = ['{name}', '{service_name}'] as const;

const PLACEHOLDER_PATTERN = /\{[^{}\s]{0,40}\}/g;

/** The placeholders in a text that are not allowed, in order of appearance. */
export function unknownPlaceholders(text: string): string[] {
  const allowed = new Set<string>(MESSAGE_PLACEHOLDERS);
  return (text.match(PLACEHOLDER_PATTERN) ?? []).filter((p) => !allowed.has(p));
}

/** What {name} becomes when a recipient has no first name on record. */
export const NAME_FALLBACK = 'friend';

export interface RenderValues {
  /** The recipient's first name; cut to nameInMessageMax. */
  readonly name?: string | null;
  readonly service_name: string;
}

/**
 * The text one recipient receives. {name} is the recipient's first name, cut
 * to 20 characters (so an SMS estimate holds for every recipient), or "friend"
 * when there is none. Nothing else is substituted.
 */
export function renderMessage(text: string, values: RenderValues): string {
  const name = (values.name ?? '').trim().slice(0, L.nameInMessageMax) || NAME_FALLBACK;
  return text.replaceAll('{name}', name).replaceAll('{service_name}', values.service_name);
}

/**
 * The SMS length the preview quotes and the schema caps: the text rendered
 * with a full-length 20-character name. A real name is never longer (it is
 * cut), so no recipient's message has more parts than this -- unless the name
 * itself needs Unicode, which the preview states.
 */
export function smsEstimate(text: string, serviceName: string) {
  return smsLength(
    renderMessage(text, { name: 'x'.repeat(L.nameInMessageMax), service_name: serviceName }),
  );
}

/** The service name used for estimates in the schema, where the setting is not known. */
const ESTIMATE_SERVICE_NAME = 'x'.repeat(80);

// ---------------------------------------------------------------------------
// TEMPLATES
// ---------------------------------------------------------------------------

const text = (min: number, max: number, message: string) =>
  z
    .string({ error: () => message })
    .trim()
    .min(min, message)
    .max(max, message);

const placeholdersOk = (v: string) => unknownPlaceholders(v).length === 0;

const titleSchema = text(L.titleMin, L.titleMax, M.titleInvalid).refine(
  placeholdersOk,
  M.placeholderUnknown,
);
const bodySchema = text(L.bodyMin, L.bodyMax, M.bodyInvalid).refine(
  placeholdersOk,
  M.placeholderUnknown,
);
const smsTooLong = (v: string) => smsEstimate(v, ESTIMATE_SERVICE_NAME).segments > L.smsSegmentsMax;

const uuid = (message: string) =>
  z
    .string({ error: () => message })
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, message);

/** POST /api/admin/message-templates -- a new draft template. */
export const templateCreateSchema = z
  .strictObject({
    name: text(L.templateNameMin, L.templateNameMax, M.templateNameInvalid),
    channel: z.enum(ANNOUNCEMENT_CHANNELS, { error: () => M.channelUnknown }),
    title: titleSchema.nullable().optional(),
    body: bodySchema,
  })
  .superRefine((v, ctx) => {
    if (v.channel === 'sms' && v.title) {
      ctx.addIssue({ code: 'custom', path: ['title'], message: M.titleNotForSms });
    }
    if (v.channel !== 'sms' && !v.title) {
      ctx.addIssue({ code: 'custom', path: ['title'], message: M.titleInvalid });
    }
    if (v.channel === 'sms' && smsTooLong(v.body)) {
      ctx.addIssue({ code: 'custom', path: ['body'], message: M.smsTooLong });
    }
  });
export type TemplateCreateInput = z.output<typeof templateCreateSchema>;

/**
 * PATCH /api/admin/message-templates/:id -- edit the text, or move it between
 * draft, active and archived. The channel never changes: a template is for
 * one channel. An archived template is kept (announcements may name it) and
 * can be restored.
 */
export const templateEditSchema = z
  .strictObject({
    name: text(L.templateNameMin, L.templateNameMax, M.templateNameInvalid).optional(),
    title: titleSchema.nullable().optional(),
    body: bodySchema.optional(),
    status: z.enum(TEMPLATE_STATUSES, { error: () => M.templateStatusUnknown }).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.title !== undefined ||
      v.body !== undefined ||
      v.status !== undefined,
    M.templateEditEmpty,
  );
export type TemplateEditInput = z.output<typeof templateEditSchema>;

/** A template as the staff screen reads it. */
export interface MessageTemplate {
  id: string;
  name: string;
  channel: AnnouncementChannel;
  title: string | null;
  body: string;
  status: TemplateStatus;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

// ---------------------------------------------------------------------------
// ANNOUNCEMENTS
// ---------------------------------------------------------------------------

export const announcementScopeSchema = z
  .strictObject({
    kind: z.enum(ANNOUNCEMENT_SCOPES, { error: () => M.scopeUnknown }),
    state_id: locationCodeSchema.nullable().optional(),
    activity: z
      .enum(ACTIVITIES, { error: () => M.scopeActivityRequired })
      .nullable()
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'state' && !v.state_id) {
      ctx.addIssue({ code: 'custom', path: ['state_id'], message: M.scopeStateRequired });
    }
    if (v.kind === 'activity' && !v.activity) {
      ctx.addIssue({ code: 'custom', path: ['activity'], message: M.scopeActivityRequired });
    }
    if ((v.kind !== 'state' && v.state_id) || (v.kind !== 'activity' && v.activity)) {
      ctx.addIssue({ code: 'custom', path: ['kind'], message: M.scopeExtraField });
    }
  })
  .transform((v) => ({
    kind: v.kind,
    state_id: v.kind === 'state' ? (v.state_id ?? null) : null,
    activity: v.kind === 'activity' ? (v.activity ?? null) : null,
  }));
export type AnnouncementScope = z.output<typeof announcementScopeSchema>;

/**
 * POST /api/admin/announcements (a new draft) and PUT /api/admin/announcements/:id
 * (the whole draft, replaced). The title is the in-app title and the email
 * subject; the body is the in-app and email text; the SMS text is separate,
 * because an SMS is short and billed per part.
 */
export const announcementDraftSchema = z
  .strictObject({
    title: titleSchema,
    body: bodySchema,
    sms_body: z
      .string({ error: () => M.smsBodyRequired })
      .trim()
      .max(L.bodyMax, M.smsTooLong)
      .refine(placeholdersOk, M.placeholderUnknown)
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
    category: z.enum(ANNOUNCEMENT_CATEGORIES, { error: () => M.categoryUnknown }),
    channels: z
      .array(z.enum(ANNOUNCEMENT_CHANNELS, { error: () => M.channelUnknown }), {
        error: () => M.channelsRequired,
      })
      .min(1, M.channelsRequired)
      .max(ANNOUNCEMENT_CHANNELS.length, M.channelsRequired)
      .transform((v) => ANNOUNCEMENT_CHANNELS.filter((c) => v.includes(c))),
    scope: announcementScopeSchema,
    template_id: uuid(M.templateIdInvalid)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
  })
  .superRefine((v, ctx) => {
    const sms = v.channels.includes('sms');
    if (sms && !v.sms_body) {
      ctx.addIssue({ code: 'custom', path: ['sms_body'], message: M.smsBodyRequired });
    }
    if (sms && v.sms_body && smsTooLong(v.sms_body)) {
      ctx.addIssue({ code: 'custom', path: ['sms_body'], message: M.smsTooLong });
    }
    if (v.scope.kind === 'staff' && !(v.channels.length === 1 && v.channels[0] === 'email')) {
      ctx.addIssue({ code: 'custom', path: ['channels'], message: M.staffEmailOnly });
    }
    if (v.scope.kind === 'officers' && !(v.channels.length === 1 && v.channels[0] === 'sms')) {
      ctx.addIssue({ code: 'custom', path: ['channels'], message: M.officersSmsOnly });
    }
  });
export type AnnouncementDraftInput = z.output<typeof announcementDraftSchema>;

/**
 * POST /api/admin/announcements/:id/send. The count is the one the preview
 * showed: if the recipients changed since (someone registered, someone
 * changed a preference), the send is refused and the preview is shown again,
 * so nothing goes to a group the sender did not see.
 */
export const announcementSendSchema = z.strictObject({
  confirm: z.literal(true, { error: () => M.confirmRequired }),
  expected_recipients: z
    .number({ error: () => M.expectedRecipientsInvalid })
    .int(M.expectedRecipientsInvalid)
    .min(0, M.expectedRecipientsInvalid),
});
export type AnnouncementSendInput = z.output<typeof announcementSendSchema>;

/** GET /api/admin/announcements/:id/deliveries?channel=&status=&cursor= */
export const deliveryQuerySchema = z.strictObject({
  channel: z.enum(ANNOUNCEMENT_CHANNELS, { error: () => M.deliveryFilterInvalid }).optional(),
  status: z.enum(DELIVERY_STATUSES, { error: () => M.deliveryFilterInvalid }).optional(),
  cursor: z.string().max(200).optional(),
});

/** Per channel, how many deliveries are in each state. */
export type DeliveryCounts = Record<AnnouncementChannel, Record<DeliveryStatus, number>>;

export const emptyDeliveryCounts = (): DeliveryCounts =>
  Object.fromEntries(
    ANNOUNCEMENT_CHANNELS.map((c) => [
      c,
      Object.fromEntries(DELIVERY_STATUSES.map((s) => [s, 0])) as Record<DeliveryStatus, number>,
    ]),
  ) as DeliveryCounts;

/** Rows of (channel, status, count) folded into the table the detail page shows. */
export function tallyDeliveries(
  rows: readonly { channel: string; status: string; n: number }[],
): DeliveryCounts {
  const out = emptyDeliveryCounts();
  for (const r of rows) {
    const channel = r.channel as AnnouncementChannel;
    const status = r.status as DeliveryStatus;
    if (out[channel] && status in out[channel]) out[channel][status] += r.n;
  }
  return out;
}

/** Deliveries still to be attempted: queued ones. Sending ones are in flight. */
export const remainingDeliveries = (c: DeliveryCounts): number =>
  ANNOUNCEMENT_CHANNELS.reduce((n, ch) => n + c[ch].queued + c[ch].sending, 0);

/** The preview: what would be sent, to how many, on which channel. */
export interface AnnouncementPreview {
  /** Accounts (or staff, or officers) in scope. */
  recipients: number;
  rendered: {
    title: string;
    body: string;
    sms_body: string | null;
  };
  channels: Record<
    AnnouncementChannel,
    {
      selected: boolean;
      will_send: number;
      skipped_preference: number;
      skipped_no_contact: number;
      skipped_duplicate: number;
    }
  >;
  sms: {
    segments_per_message: number;
    encoding: 'gsm7' | 'ucs2';
    total_segments: number;
    /** From the notifications setting; null when no cost per part is set. */
    cost_per_segment_usd: number | null;
    estimated_cost_usd: number | null;
  } | null;
}

/** Billed SMS parts and their cost, as the preview states them. */
export function smsCost(
  messages: number,
  segmentsPerMessage: number,
  costPerSegmentUsd: number | null,
): { total_segments: number; estimated_cost_usd: number | null } {
  const total = messages * segmentsPerMessage;
  return {
    total_segments: total,
    estimated_cost_usd:
      costPerSegmentUsd === null ? null : Math.round(total * costPerSegmentUsd * 100) / 100,
  };
}

/** An announcement as the staff screens read it. */
export interface StaffAnnouncement {
  id: string;
  title: string;
  body: string;
  sms_body: string | null;
  category: AnnouncementCategory;
  channels: AnnouncementChannel[];
  scope: AnnouncementScope;
  template_id: string | null;
  status: AnnouncementStatus;
  recipient_count: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sent_by: string | null;
  sent_at: string | null;
  completed_at: string | null;
}

/** One delivery row as the detail page lists it. No phone number, no address. */
export interface AnnouncementDelivery {
  id: string;
  channel: AnnouncementChannel;
  recipient_kind: RecipientKind;
  recipient_name: string | null;
  status: DeliveryStatus;
  skip_reason: DeliverySkipReason | null;
  provider_message_id: string | null;
  error: string | null;
  attempts: number;
  sent_at: string | null;
  updated_at: string;
}

/** An announcement in a person's own list. */
export interface AccountAnnouncement {
  id: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  sent_at: string;
}

// ---------------------------------------------------------------------------
// NOTIFICATION PREFERENCES
// ---------------------------------------------------------------------------

/**
 * What a person may switch off. Announcements on any channel; activity
 * updates (messages, advice) in the app. Essential and security messages
 * (account decisions, suspension, sign-in codes) have no switch at all.
 * No row means everything is on.
 */
export const PREFERENCE_FIELDS = [
  'announcements_in_app',
  'announcements_sms',
  'announcements_email',
  'updates_in_app',
  // 2026-10-26 (lane-realtime, migration 20261101090000): match alerts --
  // marketing notices about posts that match what a person buys or sells --
  // in the app (on) and by SMS (off: opt-in); and "show when I'm active" in
  // conversations (on, reciprocal: shared/src/presence.ts).
  'match_in_app',
  'match_sms',
  'show_activity',
] as const;
export type PreferenceField = (typeof PREFERENCE_FIELDS)[number];
export type NotificationPreferences = Record<PreferenceField, boolean>;

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  announcements_in_app: true,
  announcements_sms: true,
  announcements_email: true,
  updates_in_app: true,
  match_in_app: true,
  match_sms: false,
  show_activity: true,
};

const onOff = z.boolean({ error: () => M.preferenceInvalid });

/** PUT /api/account/notification-preferences -- every switch, each on or off. */
export const notificationPreferencesSchema = z.strictObject({
  announcements_in_app: onOff,
  announcements_sms: onOff,
  announcements_email: onOff,
  updates_in_app: onOff,
  // 2026-10-26: optional, so a screen that predates them keeps working; an
  // absent switch keeps its saved value.
  match_in_app: onOff.optional(),
  match_sms: onOff.optional(),
  show_activity: onOff.optional(),
});

/**
 * THE PREFERENCE RULE: whether this channel may carry this announcement to a
 * person with these preferences. An essential message ignores them.
 */
export function preferenceAllows(
  category: AnnouncementCategory,
  channel: AnnouncementChannel,
  preferences: NotificationPreferences | null,
): boolean {
  if (category === 'essential') return true;
  const p = preferences ?? DEFAULT_PREFERENCES;
  return p[`announcements_${channel}`];
}
