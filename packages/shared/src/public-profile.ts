import { z } from 'zod';

import { ACTIVITIES, type Activity } from './account-profile';
import { MARKET_POST_MESSAGES } from './market-posts';

/**
 * PUBLIC PROFILES, VERSION 2 (2026-10-23). CORWADO's 16 October
 * specification: "Public profiles remain drafts until previewed and
 * deliberately published. Show display name, selected actor types, general
 * location, description, chosen public contacts, relevant expertise and
 * active listings. Owners can edit, preview, unpublish, manage listings and
 * initiate deletion in settings ... Public visibility does not constitute
 * endorsement." docs/DECISIONS.md, "Public profiles v2: drafts, publishing,
 * photo".
 *
 * One profile per sign-in (account_profile), so a farmer and a buyer record on
 * one account share it. It is a DRAFT until its owner publishes it; nobody at
 * CORWADO approves it first. Its public address is `public_id`, never the
 * sign-in id. The photo is optional and lives in a private bucket; the public
 * reaches it only through a read link that expires.
 */

export const PUBLIC_PROFILE_STATUSES = ['draft', 'published', 'unpublished'] as const;
export type PublicProfileStatus = (typeof PUBLIC_PROFILE_STATUSES)[number];

export const PUBLIC_PROFILE_LIMITS = {
  displayNameMin: 2,
  displayNameMax: 120,
  aboutMax: 1000,
  tagsMax: 10,
  tagMin: 1,
  tagMax: 40,
} as const;

/** The private bucket profile photos live in. Created by `pnpm storage:buckets`. */
export const PROFILE_PHOTO_BUCKET = 'profile-photos';

export const PROFILE_PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ProfilePhotoContentType = (typeof PROFILE_PHOTO_CONTENT_TYPES)[number];

export const PROFILE_PHOTO_LIMITS = {
  /** 2 MB. The screen shrinks a photo to 800 px before it is sent. */
  maxBytes: 2 * 1024 * 1024,
  /** The longest side the screen resizes to. */
  maxPixels: 800,
  /** How long a public read link to a photo lives. */
  readLinkSeconds: 600,
} as const;

const EXTENSION: Record<ProfilePhotoContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Where one upload of a profile's photo lives: under the profile's PUBLIC id
 * (never the sign-in id), one object per upload, so a grant can never
 * overwrite the photo already shown.
 */
export const profilePhotoPath = (
  publicId: string,
  uploadId: string,
  contentType: ProfilePhotoContentType,
) => `${publicId}/${uploadId}.${EXTENSION[contentType]}`;

// ---------------------------------------------------------------------------
// MESSAGES -- each pinned in docs/api/CONVENTIONS.md §5.2.3
// ---------------------------------------------------------------------------

export const PUBLIC_PROFILE_MESSAGES = {
  displayNameInvalid: 'A name for your public profile is 2 to 120 characters.',
  activityUnknown: 'Choose what you do from the list.',
  aboutTooLong: 'Keep the description to 1000 characters.',
  stateInvalid: 'Choose your state from the list.',
  payamInvalid: 'Choose your payam from the list.',
  payamNeedsState: 'Choose a state before choosing a payam.',
  productsTooMany: 'List at most 10 products.',
  servicesTooMany: 'List at most 10 services.',
  tagInvalid: 'Each one is 1 to 40 characters.',
  photoTypeInvalid: 'Choose a JPEG, PNG or WebP photo.',
  photoTooLarge: 'A profile photo can be at most 2 MB.',
  photoSizeInvalid: 'Give the photo size as a whole number of bytes.',
  uploadIdInvalid: 'The upload identifier is not in the expected form.',
} as const;

const M = PUBLIC_PROFILE_MESSAGES;
const L = PUBLIC_PROFILE_LIMITS;

// ---------------------------------------------------------------------------
// BUILDING BLOCKS
// ---------------------------------------------------------------------------

const code = (message: string) =>
  z
    .string({ error: () => message })
    .trim()
    .regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/, message);

/** Optional location: blank or absent is none. */
const optionalCode = (message: string) =>
  z
    .union([z.literal(''), code(message)], { error: () => message })
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

/** Short free tags: trimmed, blanks dropped, each once (case-insensitively). */
const tags = (tooMany: string) =>
  z
    .array(
      z
        .string({ error: () => M.tagInvalid })
        .trim()
        .min(L.tagMin, M.tagInvalid)
        .max(L.tagMax, M.tagInvalid),
      { error: () => tooMany },
    )
    .max(L.tagsMax, tooMany)
    .transform((list) => {
      const seen = new Set<string>();
      return list.filter((tag) => {
        const key = tag.toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });

const yesNo = z.boolean({ error: () => MARKET_POST_MESSAGES.choiceUnknown });

// ---------------------------------------------------------------------------
// SAVE -- PUT /api/account/public-profile
// ---------------------------------------------------------------------------

/**
 * The profile saved whole. Saving never publishes: publishing is its own
 * deliberate step (POST .../publish). `activities` are the account's "what you
 * do" (the same list GET/PUT /api/account/profile edits), shown as its roles.
 * The phone is off by default and, when on, shown only to signed-in users.
 */
export const publicProfileSaveSchema = z
  .strictObject({
    display_name: z
      .string({ error: () => M.displayNameInvalid })
      .trim()
      .min(L.displayNameMin, M.displayNameInvalid)
      .max(L.displayNameMax, M.displayNameInvalid),
    activities: z
      .array(z.enum(ACTIVITIES, { error: () => M.activityUnknown }), {
        error: () => M.activityUnknown,
      })
      .max(ACTIVITIES.length * 2, M.activityUnknown)
      .transform((list) => [...new Set(list)] as Activity[]),
    state_id: optionalCode(M.stateInvalid),
    payam_id: optionalCode(M.payamInvalid),
    about: z
      .string({ error: () => M.aboutTooLong })
      .trim()
      .max(L.aboutMax, M.aboutTooLong)
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
    products: tags(M.productsTooMany),
    services: tags(M.servicesTooMany),
    show_phone: yesNo,
    allow_messages: yesNo,
  })
  .superRefine((value, ctx) => {
    if (value.payam_id && !value.state_id) {
      ctx.addIssue({ code: 'custom', path: ['payam_id'], message: M.payamNeedsState });
    }
  });
export type PublicProfileSave = z.infer<typeof publicProfileSaveSchema>;
export type PublicProfileSaveInput = z.input<typeof publicProfileSaveSchema>;

// ---------------------------------------------------------------------------
// PHOTO -- POST .../photo/upload-url, then POST .../photo/confirm
// ---------------------------------------------------------------------------

const contentType = z.enum(PROFILE_PHOTO_CONTENT_TYPES, { error: () => M.photoTypeInvalid });

/** Asked before any byte travels: a type and a size the bucket will accept. */
export const profilePhotoUploadSchema = z.strictObject({
  content_type: contentType,
  byte_size: z
    .number({ error: () => M.photoSizeInvalid })
    .int(M.photoSizeInvalid)
    .min(1, M.photoSizeInvalid)
    .max(PROFILE_PHOTO_LIMITS.maxBytes, M.photoTooLarge),
});
export type ProfilePhotoUpload = z.infer<typeof profilePhotoUploadSchema>;

/** The upload the grant was for. The server checks what actually arrived. */
export const profilePhotoConfirmSchema = z.strictObject({
  upload_id: z.string({ error: () => M.uploadIdInvalid }).uuid(M.uploadIdInvalid),
  content_type: contentType,
});
export type ProfilePhotoConfirm = z.infer<typeof profilePhotoConfirmSchema>;

// ---------------------------------------------------------------------------
// WHAT THE ROUTES RETURN
// ---------------------------------------------------------------------------

/** The owner's own profile, as the editor and its preview read it. */
export interface PublicProfileOwn {
  /** Null until the first save creates the profile. */
  public_id: string | null;
  status: PublicProfileStatus;
  published_at: string | null;
  display_name: string | null;
  /** A name the editor can start from when none has been saved yet. */
  suggested_name: string;
  activities: Activity[];
  state_id: string | null;
  state_name: string | null;
  payam_id: string | null;
  payam_name: string | null;
  about: string | null;
  products: string[];
  services: string[];
  show_phone: boolean;
  allow_messages: boolean;
  photo_url: string | null;
  verified_organisation: boolean;
  member_since: string | null;
  updated_at: string | null;
}

/** One post on a public profile, in its public shape. */
export interface PublicProfilePost {
  id: string;
  title: string;
  line: string;
}

/** GET /api/profiles/p/:publicId -- a published profile, as anyone sees it. */
export interface PublicProfileView {
  public_id: string;
  display_name: string;
  photo_url: string | null;
  activities: Activity[];
  profile_kind: string;
  group_kind: string | null;
  /** 2026-10-27: the enterprise size, only when the owner chose to show it; else null. */
  enterprise_size: string | null;
  location: { state: string | null; payam: string | null };
  about: string | null;
  products: string[];
  services: string[];
  /** 2026-11-01: a verified ORGANISATION (a person is never verified). */
  verified_organisation: boolean;
  member_since: string;
  can_message: boolean;
  /** Only when the owner chose to show it AND the caller is signed in. */
  phone: string | null;
  /** Whether a phone would be shown to a signed-in caller (a yes/no, never the number). */
  phone_on_sign_in: boolean;
  listings: unknown[];
  buying_requests: unknown[];
  service_listings: unknown[];
  /** 2026-10-28 (infographic no. 5): expertise from the advice provider profile. */
  expertise: PublicExpertise;
}

/**
 * 2026-10-28 (user journeys, infographic no. 5): "relevant expertise" on a
 * public profile -- the topics of the account's PUBLISHED advice provider
 * profile, and whether it holds the "Approved adviser" authorization. Nothing
 * else of the provider profile or of any application.
 */
export interface PublicExpertise {
  topics: string[];
  approved_adviser: boolean;
}
