import { z } from 'zod';

/**
 * Extension visits and attachments (C-8). Topics, limits, content types,
 * failure codes and the sentences live here; the database CHECKs are
 * generated from the same lists, so the code and the database cannot drift.
 *
 * Every sentence an officer reads is written for someone standing in a field
 * (CONVENTIONS §14): it names the action, never the fault.
 */

/** Nine, from docs/data-model-extension.md §2. Short on purpose. Proposed 2026-09-07. */
export const VISIT_TOPICS = [
  'land_preparation',
  'planting',
  'weeding',
  'pest',
  'disease',
  'harvest',
  'storage',
  'market',
  'other',
] as const;
export type VisitTopic = (typeof VISIT_TOPICS)[number];

export const ATTACHMENT_KINDS = ['photo', 'audio'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_STATUSES = ['waiting', 'arrived', 'failed'] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];

/** Why an attachment failed. Codes, never sentences; the sentence is looked up. */
export const ATTACHMENT_FAILURE_CODES = [
  'size_mismatch',
  'type_mismatch',
  'grant_expired',
  'device_gave_up',
] as const;
export type AttachmentFailureCode = (typeof ATTACHMENT_FAILURE_CODES)[number];

/**
 * Ceilings, with room (owner's instruction, 2026-09-07). A 12-megapixel JPEG
 * from a mid-range Android is 3 to 6 MB; a 48-megapixel one can reach 8 to
 * 10. Photos: 15 MB. A minute of AAC audio at 128 kbps is about 1 MB; ten
 * minutes about 10. Audio: 25 MB. The bucket enforces the larger of the two
 * at upload; the declaration refuses before any byte travels.
 */
export const ATTACHMENT_LIMITS = {
  photoMaxBytes: 15 * 1024 * 1024,
  audioMaxBytes: 25 * 1024 * 1024,
  /** Our expiry on an upload grant. The provider's token lives two hours; ours governs at confirm. */
  grantMinutes: 15,
  /** A read link lives this long (C-8.8). */
  readLinkSeconds: 300,
} as const;

export const ATTACHMENT_CONTENT_TYPES = {
  photo: ['image/jpeg', 'image/png', 'image/webp'],
  audio: ['audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/ogg', 'audio/webm'],
} as const satisfies Record<AttachmentKind, readonly string[]>;

export const VISIT_LIMITS = {
  textMax: 4000,
  durationMaxMinutes: 1440,
  attendeesMax: 10000,
  maxAccuracyM: 9999,
  /** An officer may correct their own visit this long after the SERVER received it (C-8.10). */
  correctionWindowHours: 24,
} as const;

export const VISIT_MESSAGES = {
  idRequired: 'A visit must carry its identifier.',
  idNotUuid: 'The visit identifier is not in the expected form.',
  adviceRequired: 'Write the advice you gave. A visit with no advice is not a visit.',
  adviceTooLong: 'The advice is too long to save. Shorten it to about six hundred words.',
  observationTooLong: 'The observation is too long to save. Shorten it to about six hundred words.',
  observationBlank: 'Leave the observation out, or write something in it.',
  topicsRequired: 'Tick at least one topic the visit covered.',
  topicUnknown: 'Choose the topics from the list.',
  topicsDuplicate: 'Each topic once.',
  durationInvalid: 'Give the duration as whole minutes, up to a day.',
  attendeesInvalid: 'Give the attendance as a whole number of people.',
  visitedAtInvalid: 'Record when the visit happened as a date and time.',
  positionShape: 'Send the position as a GeoJSON Point: longitude, then latitude.',
  positionRange: 'Longitude is between -180 and 180; latitude between -90 and 90.',
  accuracyRequired: 'Record the GPS accuracy in metres at capture.',
  accuracyInvalid: 'GPS accuracy is a number of metres, zero or more.',
  followUpNotUuid: 'The earlier visit is not in the expected form.',
  correctionEmpty: 'Change at least one thing, or leave the visit as it is.',
  attachmentIdNotUuid: 'The attachment identifier is not in the expected form.',
  kindUnknown: 'An attachment is a photo or an audio recording.',
  contentTypeUnknown:
    'Save the photo as JPEG, PNG or WebP, or the recording as M4A, AAC, MP3, OGG or WebM.',
  contentTypeMismatch: 'The file type does not match the kind of attachment.',
  sizeInvalid: 'The file size must be a whole number of bytes.',
  photoTooLarge:
    'This photo is too large to send. Set the camera to a smaller picture size and take it again.',
  audioTooLarge: 'This recording is too long to send. Record it again in shorter pieces.',
  capturedAtInvalid: 'Record when the attachment was captured as a date and time.',
  filterDateInvalid: 'Give the date as a full date and time with its offset.',
  filterOfficerNotUuid: 'The officer identifier is not in the expected form.',
} as const;

/**
 * What an officer, and everyone entitled to the visit, reads beside each
 * attachment (C-8.7). One sentence per state, naming the action.
 */
export const ATTACHMENT_STATUS_MESSAGES: Record<AttachmentStatus, string> = {
  waiting:
    'This has not reached the server yet. Keep the phone on with signal and it will send by itself.',
  arrived: 'Received.',
  failed: 'This did not send. Open the visit and send it again.',
};

export const ATTACHMENT_FAILURE_MESSAGES: Record<AttachmentFailureCode, string> = {
  size_mismatch: 'The file that arrived is not the one declared. Open the visit and send it again.',
  type_mismatch: 'The file that arrived is not the one declared. Open the visit and send it again.',
  grant_expired: 'The upload took too long. Open the visit and send it again.',
  device_gave_up: 'The phone could not send this. Open the visit and send it again.',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (message: string) => z.string({ error: () => message }).regex(UUID, message);

const isoDateTime = (message: string) =>
  z.string({ error: () => message }).datetime({ offset: true, message });

/** A standing point: one GeoJSON Point, longitude then latitude (C-8.4). */
export const geoJsonPointSchema = z.strictObject(
  {
    type: z.literal('Point', { error: () => VISIT_MESSAGES.positionShape }),
    coordinates: z
      .tuple(
        [
          z.number({ error: () => VISIT_MESSAGES.positionShape }),
          z.number({ error: () => VISIT_MESSAGES.positionShape }),
        ],
        { error: () => VISIT_MESSAGES.positionShape },
      )
      .refine(([lng, lat]) => lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90, {
        message: VISIT_MESSAGES.positionRange,
      }),
  },
  { error: () => VISIT_MESSAGES.positionShape },
);
export type GeoJsonPoint = z.infer<typeof geoJsonPointSchema>;

const adviceSchema = z
  .string({ error: () => VISIT_MESSAGES.adviceRequired })
  .trim()
  .min(1, VISIT_MESSAGES.adviceRequired)
  .max(VISIT_LIMITS.textMax, VISIT_MESSAGES.adviceTooLong);

const observationSchema = z
  .string({ error: () => VISIT_MESSAGES.observationBlank })
  .trim()
  .min(1, VISIT_MESSAGES.observationBlank)
  .max(VISIT_LIMITS.textMax, VISIT_MESSAGES.observationTooLong);

const topicsSchema = z
  .array(z.enum(VISIT_TOPICS, { error: () => VISIT_MESSAGES.topicUnknown }), {
    error: () => VISIT_MESSAGES.topicsRequired,
  })
  .min(1, VISIT_MESSAGES.topicsRequired)
  .refine((list) => new Set(list).size === list.length, {
    message: VISIT_MESSAGES.topicsDuplicate,
  });

const durationSchema = z
  .number({ error: () => VISIT_MESSAGES.durationInvalid })
  .int(VISIT_MESSAGES.durationInvalid)
  .min(1, VISIT_MESSAGES.durationInvalid)
  .max(VISIT_LIMITS.durationMaxMinutes, VISIT_MESSAGES.durationInvalid);

const attendeesSchema = z
  .number({ error: () => VISIT_MESSAGES.attendeesInvalid })
  .int(VISIT_MESSAGES.attendeesInvalid)
  .min(1, VISIT_MESSAGES.attendeesInvalid)
  .max(VISIT_LIMITS.attendeesMax, VISIT_MESSAGES.attendeesInvalid);

const accuracySchema = z
  .number({ error: () => VISIT_MESSAGES.accuracyRequired })
  .min(0, VISIT_MESSAGES.accuracyInvalid)
  .max(VISIT_LIMITS.maxAccuracyM, VISIT_MESSAGES.accuracyInvalid);

/** Recording a visit (C-8.1–C-8.5). Nullable optionals: a phone sends null for "not given". */
export const recordVisitSchema = z.strictObject({
  id: uuid(VISIT_MESSAGES.idNotUuid),
  visited_at: isoDateTime(VISIT_MESSAGES.visitedAtInvalid),
  position: geoJsonPointSchema,
  gps_accuracy_m: accuracySchema,
  observation: observationSchema.nullable().optional(),
  advice: adviceSchema,
  topics: topicsSchema,
  duration_minutes: durationSchema.nullable().optional(),
  attendee_count: attendeesSchema.nullable().optional(),
  follow_up_of: uuid(VISIT_MESSAGES.followUpNotUuid).nullable().optional(),
});
export type RecordVisit = z.infer<typeof recordVisitSchema>;

/**
 * Correcting a visit (C-8.10): what was observed, advised, covered, how long
 * and how many, and the follow-up link. Never the farmer, the officer, the
 * position or either moment — those keys are not here, so they are refused
 * as unknown fields before any rule is consulted.
 */
export const correctVisitSchema = z
  .strictObject({
    observation: observationSchema.nullable().optional(),
    advice: adviceSchema.optional(),
    topics: topicsSchema.optional(),
    duration_minutes: durationSchema.nullable().optional(),
    attendee_count: attendeesSchema.nullable().optional(),
    follow_up_of: uuid(VISIT_MESSAGES.followUpNotUuid).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: VISIT_MESSAGES.correctionEmpty });
export type CorrectVisit = z.infer<typeof correctVisitSchema>;

const contentTypes: readonly string[] = [
  ...ATTACHMENT_CONTENT_TYPES.photo,
  ...ATTACHMENT_CONTENT_TYPES.audio,
];

/**
 * Declaring an attachment (C-8.6): the row, before the bytes. The size and
 * type are judged HERE, before any upload grant is issued, so a phone that
 * exceeds the ceiling is refused before the bytes travel, with a sentence
 * naming the action.
 */
export const declareAttachmentSchema = z
  .strictObject({
    id: uuid(VISIT_MESSAGES.attachmentIdNotUuid),
    kind: z.enum(ATTACHMENT_KINDS, { error: () => VISIT_MESSAGES.kindUnknown }),
    content_type: z
      .string({ error: () => VISIT_MESSAGES.contentTypeUnknown })
      .trim()
      .toLowerCase()
      .refine((t) => contentTypes.includes(t), { message: VISIT_MESSAGES.contentTypeUnknown }),
    byte_size: z
      .number({ error: () => VISIT_MESSAGES.sizeInvalid })
      .int(VISIT_MESSAGES.sizeInvalid)
      .min(1, VISIT_MESSAGES.sizeInvalid),
    captured_at: isoDateTime(VISIT_MESSAGES.capturedAtInvalid),
  })
  .superRefine((body, ctx) => {
    const allowed: readonly string[] = ATTACHMENT_CONTENT_TYPES[body.kind];
    if (!allowed.includes(body.content_type)) {
      ctx.addIssue({
        code: 'custom',
        path: ['content_type'],
        message: VISIT_MESSAGES.contentTypeMismatch,
      });
    }
    const ceiling =
      body.kind === 'photo' ? ATTACHMENT_LIMITS.photoMaxBytes : ATTACHMENT_LIMITS.audioMaxBytes;
    if (body.byte_size > ceiling) {
      ctx.addIssue({
        code: 'custom',
        path: ['byte_size'],
        message:
          body.kind === 'photo' ? VISIT_MESSAGES.photoTooLarge : VISIT_MESSAGES.audioTooLarge,
      });
    }
  });
export type DeclareAttachment = z.infer<typeof declareAttachmentSchema>;

/** The phone gave up on an attachment (C-8.7). No body beyond the intent. */
export const failAttachmentSchema = z.strictObject({});

/** GET /api/visits filters. Dates filter the SERVER's moment (C-8.5). */
export const visitFilterSchema = z.strictObject({
  farmer: uuid(VISIT_MESSAGES.idNotUuid).optional(),
  officer: uuid(VISIT_MESSAGES.filterOfficerNotUuid).optional(),
  payam: z.string().trim().min(1).optional(),
  from: isoDateTime(VISIT_MESSAGES.filterDateInvalid).optional(),
  to: isoDateTime(VISIT_MESSAGES.filterDateInvalid).optional(),
  /** C-9.9: visits whose server moment of last change is after this. */
  updated_since: isoDateTime(VISIT_MESSAGES.filterDateInvalid).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});
export type VisitFilter = z.infer<typeof visitFilterSchema>;

/** The server's storage path for an attachment: from the two ids, never from the client (C-8.8). */
export const attachmentStoragePath = (
  visitId: string,
  attachmentId: string,
  contentType: string,
): string => {
  const ext =
    {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'audio/mp4': 'm4a',
      'audio/aac': 'aac',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'audio/webm': 'webm',
    }[contentType] ?? 'bin';
  return `visits/${visitId}/${attachmentId}.${ext}`;
};

/** The bucket. Private, no public policy; one module issues grants (C-8.8). */
export const VISIT_ATTACHMENT_BUCKET = 'visit-attachments';
