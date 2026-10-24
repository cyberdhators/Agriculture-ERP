import { z } from 'zod';

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
export const SETTING_KEYS = ['identity', 'support', 'maintenance', 'reason_codes'] as const;
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
  settingKeyUnknown: 'Choose identity, support, maintenance or reason codes.',
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

export const SETTING_SCHEMAS = {
  identity: identitySettingSchema,
  support: supportSettingSchema,
  maintenance: maintenanceSettingSchema,
  reason_codes: reasonCodesSettingSchema,
} as const;

export interface SettingValues {
  identity: IdentitySetting;
  support: SupportSetting;
  maintenance: MaintenanceSetting;
  reason_codes: ReasonCodesSetting;
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
}
