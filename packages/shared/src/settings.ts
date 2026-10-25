import { z } from 'zod';

import { LISTING_CATEGORIES, LISTING_UNITS } from './buyer';
import { PROFILE_CROPS } from './farmer-account';

/**
 * SETTINGS, PHASE 1 (2026-10-25). CORWADO's 16 October specification, the
 * "Settings" tab: "Service configuration, policy versions, security,
 * integration and recovery controls". docs/DECISIONS.md, "Settings, phase 1".
 *
 * Four settings, each a JSON value with its own schema here, and versioned
 * notices (consent, terms, privacy). Read and written at /admin/settings by
 * staff holding `settings.manage`; every save appends a new version and an
 * audit row, so no earlier value is ever lost.
 *
 * NOTHING HERE IS A SECRET, AND NOTHING HERE MAY HOLD ONE. Integrations are
 * reported as "this variable NAME is present", computed on the server.
 *
 * Everything in this file is pure: the schemas, the defaults, the version
 * comparison and the reason-code archive rule. The routes ask them; the tests
 * ask them directly.
 */

// ---------------------------------------------------------------------------
// KEYS AND LIMITS
// ---------------------------------------------------------------------------

/** The setting_version_key_known CHECK in migration 20261025100000. */
export const SETTING_KEYS = [
  'identity',
  'support',
  'maintenance',
  'reason_codes',
  // Phase 2 (2026-10-27), migration 20261027110100_settings_phase2.
  'language_region',
  'registration_recovery',
  'profile_privacy',
  'reference_lists',
  'notifications_moderation',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const SETTINGS_LIMITS = {
  serviceNameMin: 2,
  serviceNameMax: 80,
  aboutMax: 2000,
  contactMax: 40,
  emailMax: 254,
  officeHoursMax: 200,
  helpLinksMax: 10,
  linkLabelMin: 2,
  linkLabelMax: 80,
  linkUrlMax: 500,
  bannerMin: 5,
  bannerMax: 300,
  reasonCodesMin: 1,
  reasonCodesMax: 50,
  reasonLabelMin: 3,
  reasonLabelMax: 80,
  noticeVersionMax: 16,
  noticeBodyMin: 20,
  noticeBodyMax: 20000,
  historyMax: 50,
} as const;

const L = SETTINGS_LIMITS;

// ---------------------------------------------------------------------------
// MESSAGES -- each pinned in docs/api/CONVENTIONS.md §5.2.3
// ---------------------------------------------------------------------------

export const SETTINGS_MESSAGES = {
  settingKeyUnknown: 'Choose a settings section from the list.',
  expectedVersionInvalid: 'Send the version you loaded, as a whole number.',
  serviceNameInvalid: 'Give a service name of 2 to 80 characters.',
  aboutTooLong: 'Keep the About text to 2000 characters.',
  contactNumberInvalid:
    'Enter up to 40 digits, spaces and hyphens, starting with + for a country code.',
  contactEmailInvalid: 'Enter an email address such as help@example.org.',
  officeHoursTooLong: 'Keep the opening hours to 200 characters.',
  helpLinksTooMany: 'List at most 10 help links.',
  helpLinkLabelInvalid: 'Give each link a label of 2 to 80 characters.',
  helpLinkUrlInvalid: 'Give each link a full address starting https://, up to 500 characters.',
  switchInvalid: 'Choose on or off.',
  bannerTooLong: 'Keep the notice to 300 characters.',
  bannerRequired: 'Write a notice of 5 to 300 characters before switching the banner on.',
  reasonCodesCount: 'Keep between 1 and 50 reason codes.',
  reasonCodeInvalid:
    'A code is 2 to 40 lower-case letters, digits and underscores, starting with a letter.',
  reasonCodeDuplicate: 'Each code may appear only once.',
  reasonLabelInvalid: 'Give each reason a label of 3 to 80 characters.',
  reasonAppliesToInvalid: 'Choose at least one of listing, account, profile or report.',
  noticeKindUnknown: 'Choose consent, terms or privacy.',
  noticeLanguageUnknown: 'Choose en or ar.',
  noticeVersionInvalid: 'Give the version as v followed by numbers, such as v1.4.',
  noticeBodyInvalid: 'Write the notice in 20 to 20000 characters.',
  noticeEditEmpty: 'Change the version or the text before saving.',
  // Phase 2 (2026-10-27)
  languagesInvalid: 'Keep English switched on, with Arabic on or off.',
  dateFormatUnknown: 'Choose one of the date formats in the list.',
  wholeNumberInRange: 'Enter a whole number within the range shown.',
  categoryUnknown: 'Choose categories from the list.',
  unitUnknown: 'Choose units from the list.',
  cropUnknown: 'Choose crops from the list.',
  archiveAll: 'Keep at least one choice in each list available.',
  reminderAfterValidity: 'Send the reminder before the listing ends: fewer days than it stays listed.',
  smsCostInvalid: 'Enter the cost of one SMS part in US dollars, from 0 to 1, or leave it blank.',
} as const;

const M = SETTINGS_MESSAGES;

// ---------------------------------------------------------------------------
// THE FOUR SETTINGS
// ---------------------------------------------------------------------------

/** Optional text: blank becomes null. */
const optionalText = (max: number, message: string) =>
  z
    .string({ error: () => message })
    .trim()
    .max(max, message)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

/** A phone or WhatsApp number as CORWADO publishes it: digits, spaces, hyphens, an optional +. */
const CONTACT_NUMBER = /^\+?[0-9][0-9 -]{4,38}$/;

const optionalNumber = z
  .string({ error: () => M.contactNumberInvalid })
  .trim()
  .refine((v) => v === '' || CONTACT_NUMBER.test(v), M.contactNumberInvalid)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const optionalEmail = z
  .string({ error: () => M.contactEmailInvalid })
  .trim()
  .toLowerCase()
  .max(L.emailMax, M.contactEmailInvalid)
  .refine((v) => v === '' || z.email().safeParse(v).success, M.contactEmailInvalid)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

/** Identity and help: the approved service name and the About text. */
export const identitySettingSchema = z.strictObject({
  service_name: z
    .string({ error: () => M.serviceNameInvalid })
    .trim()
    .min(L.serviceNameMin, M.serviceNameInvalid)
    .max(L.serviceNameMax, M.serviceNameInvalid),
  about: z
    .string({ error: () => M.aboutTooLong })
    .trim()
    .max(L.aboutMax, M.aboutTooLong)
    .optional()
    .transform((v) => v ?? ''),
});
export type IdentitySetting = z.output<typeof identitySettingSchema>;

export const helpLinkSchema = z.strictObject({
  label: z
    .string({ error: () => M.helpLinkLabelInvalid })
    .trim()
    .min(L.linkLabelMin, M.helpLinkLabelInvalid)
    .max(L.linkLabelMax, M.helpLinkLabelInvalid),
  // https only: a help link opens from a public page, and nothing but a web
  // address is ever wanted there.
  url: z
    .string({ error: () => M.helpLinkUrlInvalid })
    .trim()
    .max(L.linkUrlMax, M.helpLinkUrlInvalid)
    .refine((v) => {
      if (!v.startsWith('https://')) return false;
      try {
        return new URL(v).protocol === 'https:';
      } catch {
        return false;
      }
    }, M.helpLinkUrlInvalid),
});
export type HelpLink = z.output<typeof helpLinkSchema>;

/** Support contacts and help links, shown on /help and in the site footer. */
export const supportSettingSchema = z.strictObject({
  phone: optionalNumber,
  email: optionalEmail,
  whatsapp: optionalNumber,
  office_hours: optionalText(L.officeHoursMax, M.officeHoursTooLong),
  help_links: z
    .array(helpLinkSchema, { error: () => M.helpLinksTooMany })
    .max(L.helpLinksMax, M.helpLinksTooMany)
    .optional()
    .transform((v) => v ?? []),
});
export type SupportSetting = z.output<typeof supportSettingSchema>;

/** The maintenance banner: shown at the top of every page while it is on. */
export const maintenanceSettingSchema = z
  .strictObject({
    enabled: z.boolean({ error: () => M.switchInvalid }),
    message: z
      .string({ error: () => M.bannerTooLong })
      .trim()
      .max(L.bannerMax, M.bannerTooLong)
      .optional()
      .transform((v) => v ?? ''),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && value.message.length < L.bannerMin) {
      ctx.addIssue({ code: 'custom', path: ['message'], message: M.bannerRequired });
    }
  });
export type MaintenanceSetting = z.output<typeof maintenanceSettingSchema>;

/** What a moderation reason code may be offered for. */
export const REASON_TARGETS = ['listing', 'account', 'profile', 'report'] as const;
export type ReasonTarget = (typeof REASON_TARGETS)[number];

export const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

/** A code as the dialogs send it beside the free-text reason. Optional there. */
export const reasonCodeSchema = z
  .string({ error: () => M.reasonCodeInvalid })
  .trim()
  .regex(REASON_CODE_PATTERN, M.reasonCodeInvalid);

export const reasonCodeEntrySchema = z.strictObject({
  code: reasonCodeSchema,
  label: z
    .string({ error: () => M.reasonLabelInvalid })
    .trim()
    .min(L.reasonLabelMin, M.reasonLabelInvalid)
    .max(L.reasonLabelMax, M.reasonLabelInvalid),
  applies_to: z
    .array(z.enum(REASON_TARGETS, { error: () => M.reasonAppliesToInvalid }), {
      error: () => M.reasonAppliesToInvalid,
    })
    .min(1, M.reasonAppliesToInvalid)
    .max(REASON_TARGETS.length, M.reasonAppliesToInvalid)
    .transform((v) => [...new Set(v)]),
  active: z.boolean({ error: () => M.switchInvalid }),
});
export type ReasonCodeEntry = z.output<typeof reasonCodeEntrySchema>;

export const reasonCodesSettingSchema = z
  .strictObject({
    codes: z
      .array(reasonCodeEntrySchema, { error: () => M.reasonCodesCount })
      .min(L.reasonCodesMin, M.reasonCodesCount)
      .max(L.reasonCodesMax, M.reasonCodesCount),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.codes.forEach((entry, index) => {
      if (seen.has(entry.code)) {
        ctx.addIssue({
          code: 'custom',
          path: ['codes', index, 'code'],
          message: M.reasonCodeDuplicate,
        });
      }
      seen.add(entry.code);
    });
  });
export type ReasonCodesSetting = z.output<typeof reasonCodesSettingSchema>;

// ---------------------------------------------------------------------------
// PHASE 2 (2026-10-27) -- the remaining subsections of the Settings table.
// docs/DECISIONS.md, "Settings, phase 2". Each value is read by the code
// named beside it; a field with no reader is not offered.
// ---------------------------------------------------------------------------

/** Every screen's time display: fixed, shown, never edited. */
export const SERVICE_TIME_ZONE = 'Africa/Juba';
/** Prices are recorded in South Sudanese pounds (every `price_ssp` column). */
export const SERVICE_CURRENCY = 'SSP';

export const SERVICE_LANGUAGES = ['en', 'ar'] as const;

/** How the portal writes a date. The first is the design document's "27 Jul 2026". */
export const DATE_FORMATS = ['d_mmm_yyyy', 'dd_mm_yyyy', 'yyyy_mm_dd'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export const DATE_FORMAT_LABELS: Readonly<Record<DateFormat, string>> = {
  d_mmm_yyyy: '27 Jul 2026',
  dd_mm_yyyy: '27/07/2026',
  yyyy_mm_dd: '2026-07-27',
};

const wholeNumber = (min: number, max: number) =>
  z
    .number({ error: () => M.wholeNumberInRange })
    .int(M.wholeNumberInRange)
    .min(min, M.wholeNumberInRange)
    .max(max, M.wholeNumberInRange);

export const PHASE2_RANGES = {
  codeResendSeconds: [30, 600],
  sessionInactivityMinutes: [5, 240],
  minimumAgeYears: [10, 25],
  listingValidityDays: [7, 180],
  listingReminderDays: [1, 30],
  suspensionReviewDays: [1, 365],
  appealWindowDays: [7, 180],
} as const;
const R = PHASE2_RANGES;

/**
 * Language and region. `enabled_languages` is read by the farmer screens'
 * language choices; `date_format` by the portal's date display. English is
 * always on: every text has an English original.
 */
export const languageRegionSettingSchema = z.strictObject({
  enabled_languages: z
    .array(z.enum(SERVICE_LANGUAGES, { error: () => M.languagesInvalid }), {
      error: () => M.languagesInvalid,
    })
    .transform((v) => SERVICE_LANGUAGES.filter((l) => v.includes(l)))
    .refine((v) => v.includes('en'), M.languagesInvalid),
  date_format: z.enum(DATE_FORMATS, { error: () => M.dateFormatUnknown }),
});
export type LanguageRegionSetting = z.output<typeof languageRegionSettingSchema>;

/**
 * Registration and recovery. The code cooldown is read by the sign-up code
 * route; the inactivity threshold by the access log (a return session); the
 * minimum age by farmer self-registration (null: no minimum, as before).
 * There is deliberately no switch for self-service registration: the
 * specification preserves it.
 */
export const registrationRecoverySettingSchema = z.strictObject({
  code_resend_seconds: wholeNumber(R.codeResendSeconds[0], R.codeResendSeconds[1]),
  session_inactivity_minutes: wholeNumber(
    R.sessionInactivityMinutes[0],
    R.sessionInactivityMinutes[1],
  ),
  minimum_age_years: wholeNumber(R.minimumAgeYears[0], R.minimumAgeYears[1]).nullable(),
});
export type RegistrationRecoverySetting = z.output<typeof registrationRecoverySettingSchema>;

/**
 * Profile privacy defaults: what a NEW profile starts with. Read when an
 * account's profile row is first created; an existing profile is never
 * changed by a new default, so nobody is exposed silently.
 */
export const profilePrivacySettingSchema = z.strictObject({
  show_phone_default: z.boolean({ error: () => M.switchInvalid }),
  allow_messages_default: z.boolean({ error: () => M.switchInvalid }),
});
export type ProfilePrivacySetting = z.output<typeof profilePrivacySettingSchema>;

const archiveList = <T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z
    .array(z.enum(values, { error: () => message }), { error: () => message })
    .transform((v) => values.filter((x) => (v as string[]).includes(x)) as T[number][])
    .refine((v) => v.length < values.length, M.archiveAll);

/**
 * Marketplace and reference lists. The validity is read when a listing or a
 * service is given no end date. Archived categories and units are left out of
 * the forms for NEW posts and refused by the routes that create them;
 * archived crops are left out of the registration form. Every existing record
 * keeps its value and is shown as before.
 */
export const referenceListsSettingSchema = z
  .strictObject({
    listing_validity_days: wholeNumber(R.listingValidityDays[0], R.listingValidityDays[1]),
    listing_reminder_days: wholeNumber(R.listingReminderDays[0], R.listingReminderDays[1]),
    archived_categories: archiveList(LISTING_CATEGORIES, M.categoryUnknown),
    archived_units: archiveList(LISTING_UNITS, M.unitUnknown),
    archived_crops: archiveList(PROFILE_CROPS, M.cropUnknown),
  })
  .superRefine((v, ctx) => {
    if (v.listing_reminder_days >= v.listing_validity_days) {
      ctx.addIssue({
        code: 'custom',
        path: ['listing_reminder_days'],
        message: M.reminderAfterValidity,
      });
    }
  });
export type ReferenceListsSetting = z.output<typeof referenceListsSettingSchema>;

/**
 * Notifications and moderation. The SMS cost is read by the announcement
 * preview; the suspension review period by the suspend dialog; the appeal
 * window by the help page's appeal text. Templates, channel preferences and
 * delivery records are in Communications.
 */
export const notificationsModerationSettingSchema = z.strictObject({
  sms_cost_per_segment_usd: z
    .number({ error: () => M.smsCostInvalid })
    .min(0, M.smsCostInvalid)
    .max(1, M.smsCostInvalid)
    .nullable(),
  suspension_review_days: wholeNumber(R.suspensionReviewDays[0], R.suspensionReviewDays[1]),
  appeal_window_days: wholeNumber(R.appealWindowDays[0], R.appealWindowDays[1]),
});
export type NotificationsModerationSetting = z.output<typeof notificationsModerationSettingSchema>;

export const SETTING_SCHEMAS = {
  identity: identitySettingSchema,
  support: supportSettingSchema,
  maintenance: maintenanceSettingSchema,
  reason_codes: reasonCodesSettingSchema,
  language_region: languageRegionSettingSchema,
  registration_recovery: registrationRecoverySettingSchema,
  profile_privacy: profilePrivacySettingSchema,
  reference_lists: referenceListsSettingSchema,
  notifications_moderation: notificationsModerationSettingSchema,
} as const;

export interface SettingValues {
  identity: IdentitySetting;
  support: SupportSetting;
  maintenance: MaintenanceSetting;
  reason_codes: ReasonCodesSetting;
  language_region: LanguageRegionSetting;
  registration_recovery: RegistrationRecoverySetting;
  profile_privacy: ProfilePrivacySetting;
  reference_lists: ReferenceListsSetting;
  notifications_moderation: NotificationsModerationSetting;
}

/**
 * THE FALLBACKS: what the service showed before any setting was saved, so an
 * unset key changes nothing. The service name is the one the site already
 * carries; no support contact was published, so none is shown; the banner is
 * off. Reason codes are seeded by the migration, and these are the same six.
 */
export const SETTING_DEFAULTS: SettingValues = {
  identity: { service_name: 'AgriOne South Sudan', about: '' },
  support: { phone: null, email: null, whatsapp: null, office_hours: null, help_links: [] },
  maintenance: { enabled: false, message: '' },
  reason_codes: {
    codes: [
      {
        code: 'prohibited_content',
        label: 'Prohibited content',
        applies_to: ['listing', 'profile', 'report'],
        active: true,
      },
      {
        code: 'misleading_listing',
        label: 'Misleading listing',
        applies_to: ['listing', 'report'],
        active: true,
      },
      {
        code: 'fraud_or_scam',
        label: 'Fraud or scam',
        applies_to: ['listing', 'account', 'profile', 'report'],
        active: true,
      },
      {
        code: 'abusive_behaviour',
        label: 'Abusive behaviour',
        applies_to: ['account', 'profile', 'report'],
        active: true,
      },
      {
        code: 'duplicate_or_spam',
        label: 'Duplicate or spam',
        applies_to: ['listing', 'account', 'profile', 'report'],
        active: true,
      },
      {
        code: 'other',
        label: 'Other',
        applies_to: ['listing', 'account', 'profile', 'report'],
        active: true,
      },
    ],
  },
  // Phase 2: each fallback is what the code did before the setting existed.
  language_region: { enabled_languages: ['en', 'ar'], date_format: 'd_mmm_yyyy' },
  registration_recovery: {
    code_resend_seconds: 60,
    session_inactivity_minutes: 30,
    minimum_age_years: null,
  },
  profile_privacy: { show_phone_default: false, allow_messages_default: true },
  reference_lists: {
    listing_validity_days: 30,
    listing_reminder_days: 3,
    archived_categories: [],
    archived_units: [],
    archived_crops: [],
  },
  notifications_moderation: {
    sms_cost_per_segment_usd: null,
    suspension_review_days: 30,
    appeal_window_days: 30,
  },
};

/**
 * A stored value read back. It was checked when it was saved; if it no longer
 * fits the schema (a schema tightened later), the fallback is used rather
 * than a half-valid value reaching a public page.
 */
export function readSetting<K extends SettingKey>(key: K, stored: unknown): SettingValues[K] {
  if (stored === null || stored === undefined) return SETTING_DEFAULTS[key];
  const parsed = SETTING_SCHEMAS[key].safeParse(stored);
  return parsed.success ? (parsed.data as SettingValues[K]) : SETTING_DEFAULTS[key];
}

const expectedVersion = z
  .number({ error: () => M.expectedVersionInvalid })
  .int(M.expectedVersionInvalid)
  .min(0, M.expectedVersionInvalid);

/**
 * PUT /api/admin/settings { key, expected_version, value }. expected_version
 * is the version the screen loaded (0 when the key was never saved); a save
 * against an older one is refused, so two administrators cannot silently
 * overwrite each other.
 */
export const settingSaveSchema = z.discriminatedUnion(
  'key',
  [
    z.strictObject({
      key: z.literal('identity'),
      expected_version: expectedVersion,
      value: identitySettingSchema,
    }),
    z.strictObject({
      key: z.literal('support'),
      expected_version: expectedVersion,
      value: supportSettingSchema,
    }),
    z.strictObject({
      key: z.literal('maintenance'),
      expected_version: expectedVersion,
      value: maintenanceSettingSchema,
    }),
    z.strictObject({
      key: z.literal('reason_codes'),
      expected_version: expectedVersion,
      value: reasonCodesSettingSchema,
    }),
    z.strictObject({
      key: z.literal('language_region'),
      expected_version: expectedVersion,
      value: languageRegionSettingSchema,
    }),
    z.strictObject({
      key: z.literal('registration_recovery'),
      expected_version: expectedVersion,
      value: registrationRecoverySettingSchema,
    }),
    z.strictObject({
      key: z.literal('profile_privacy'),
      expected_version: expectedVersion,
      value: profilePrivacySettingSchema,
    }),
    z.strictObject({
      key: z.literal('reference_lists'),
      expected_version: expectedVersion,
      value: referenceListsSettingSchema,
    }),
    z.strictObject({
      key: z.literal('notifications_moderation'),
      expected_version: expectedVersion,
      value: notificationsModerationSettingSchema,
    }),
  ],
  { error: () => M.settingKeyUnknown },
);
export type SettingSaveInput = z.output<typeof settingSaveSchema>;

/** GET /api/admin/settings/history?key= */
export const settingHistoryQuerySchema = z.strictObject({
  key: z.enum(SETTING_KEYS, { error: () => M.settingKeyUnknown }),
});

/** GET /api/admin/reason-codes?applies_to= */
export const reasonCodesQuerySchema = z.strictObject({
  applies_to: z.enum(REASON_TARGETS, { error: () => M.reasonAppliesToInvalid }),
});

/**
 * THE ARCHIVE RULE. A reason code is never deleted, because past decisions
 * may name it: a save that drops a code which existed before is refused. Its
 * label may change, and it may be archived (active: false) and restored.
 * Returns the codes that would be lost.
 */
export function droppedReasonCodes(
  before: ReasonCodesSetting,
  after: ReasonCodesSetting,
): string[] {
  const kept = new Set(after.codes.map((c) => c.code));
  return before.codes.map((c) => c.code).filter((code) => !kept.has(code));
}

/** The active codes offered for one kind of decision, in the order staff arranged them. */
export function reasonCodesFor(setting: ReasonCodesSetting, target: ReasonTarget) {
  return setting.codes
    .filter((c) => c.active && c.applies_to.includes(target))
    .map((c) => ({ code: c.code, label: c.label }));
}

/**
 * The NAMES of the top-level fields that differ between two values -- what an
 * audit row records, never the text itself.
 */
export function changedSettingFields(before: object, after: object): string[] {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
}

// ---------------------------------------------------------------------------
// NOTICES -- versioned consent, terms and privacy texts
// ---------------------------------------------------------------------------

/** notice_kind_known in migration 20261025100000. */
export const NOTICE_KINDS = ['consent', 'terms', 'privacy'] as const;
export type PolicyNoticeKind = (typeof NOTICE_KINDS)[number];

export const NOTICE_LANGUAGES = ['en', 'ar'] as const;
export type NoticeLanguage = (typeof NOTICE_LANGUAGES)[number];

export const NOTICE_STATUSES = ['draft', 'published', 'retired'] as const;
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];

/** notice_version_shape: 'v1', 'v1.3', 'v2.0.1'. */
export const NOTICE_VERSION_PATTERN = /^v[0-9]{1,3}(\.[0-9]{1,3}){0,2}$/;

const noticeVersion = z
  .string({ error: () => M.noticeVersionInvalid })
  .trim()
  .max(L.noticeVersionMax, M.noticeVersionInvalid)
  .regex(NOTICE_VERSION_PATTERN, M.noticeVersionInvalid);

const noticeBody = z
  .string({ error: () => M.noticeBodyInvalid })
  .trim()
  .min(L.noticeBodyMin, M.noticeBodyInvalid)
  .max(L.noticeBodyMax, M.noticeBodyInvalid);

/** POST /api/admin/notices -- a new draft. */
export const noticeDraftSchema = z.strictObject({
  kind: z.enum(NOTICE_KINDS, { error: () => M.noticeKindUnknown }),
  language: z.enum(NOTICE_LANGUAGES, { error: () => M.noticeLanguageUnknown }),
  version: noticeVersion,
  body: noticeBody,
});
export type NoticeDraftInput = z.output<typeof noticeDraftSchema>;

/** PATCH /api/admin/notices/:id -- a draft's version or text. */
export const noticeEditSchema = z
  .strictObject({
    version: noticeVersion.optional(),
    body: noticeBody.optional(),
  })
  .refine((v) => v.version !== undefined || v.body !== undefined, M.noticeEditEmpty);
export type NoticeEditInput = z.output<typeof noticeEditSchema>;

/** GET /api/notices/current?kind=&lang= -- public. */
export const noticeCurrentQuerySchema = z.strictObject({
  kind: z.enum(NOTICE_KINDS, { error: () => M.noticeKindUnknown }),
  lang: z.enum(NOTICE_LANGUAGES, { error: () => M.noticeLanguageUnknown }),
});

/**
 * The text version a sign-up records on public.consent: 'v1.3' in English is
 * 'v1.3-en', exactly as the screens recorded it before notices were stored.
 */
export function consentTextVersion(version: string, language: NoticeLanguage): string {
  return `${version}-${language}`;
}

/**
 * Compares two notice versions numerically: 'v1.10' is after 'v1.9', and
 * 'v1.3' equals 'v1.3.0'. Negative, zero or positive, as a sort comparator.
 */
export function compareNoticeVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** A notice as the staff screen reads it. */
export interface StaffNotice {
  id: string;
  kind: PolicyNoticeKind;
  language: NoticeLanguage;
  version: string;
  text_version: string;
  body: string;
  status: NoticeStatus;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  retired_at: string | null;
}

/** The published notice, as the sign-up screens read it. */
export interface CurrentNotice {
  kind: PolicyNoticeKind;
  language: NoticeLanguage;
  version: string;
  text_version: string;
  body: string;
  published_at: string;
}

/** The public settings, as /help, the footer and the banner read them. */
export interface PublicSettings {
  service_name: string;
  about: string;
  support: SupportSetting;
  maintenance: MaintenanceSetting;
  /** Phase 2 (2026-10-27): what public and account screens read. No staff-only value. */
  language_region: LanguageRegionSetting;
  reference_lists: Pick<
    ReferenceListsSetting,
    | 'listing_validity_days'
    | 'listing_reminder_days'
    | 'archived_categories'
    | 'archived_units'
    | 'archived_crops'
  >;
  appeal_window_days: number;
  /** Shown in the suspend dialog; a policy number, not anybody's data. */
  suspension_review_days: number;
}

/**
 * Whether a year of birth meets the minimum age (null: no minimum). Only the
 * year is recorded, so the age is taken as this year minus that year -- the
 * most a person can be, so nobody old enough is refused.
 */
export function meetsMinimumAge(
  yearOfBirth: number,
  minimumAgeYears: number | null,
  now: Date = new Date(),
): boolean {
  if (minimumAgeYears === null) return true;
  return now.getUTCFullYear() - yearOfBirth >= minimumAgeYears;
}

/**
 * Whether a choice may be made for a NEW post: the archived category or unit
 * it names, or null. An archived value never blocks an existing record.
 */
export function archivedChoice(
  setting: Pick<ReferenceListsSetting, 'archived_categories' | 'archived_units'>,
  choice: { category?: string | null; unit?: string | null; price_per?: string | null },
): 'category' | 'unit' | null {
  if (choice.category && (setting.archived_categories as string[]).includes(choice.category)) {
    return 'category';
  }
  for (const unit of [choice.unit, choice.price_per]) {
    if (unit && (setting.archived_units as string[]).includes(unit)) return 'unit';
  }
  return null;
}
