import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTIONS,
  DEFAULT_VALIDITY_DAYS,
  LISTING_UNITS,
  NOTICE_KINDS,
  PHONE_CODE,
  RETURN_SESSION_INACTIVITY_MS,
  archivedChoice,
  meetsMinimumAge,
  REASON_TARGETS,
  SETTING_DEFAULTS,
  SETTING_KEYS,
  SETTINGS_MESSAGES as M,
  accountSanctionSchema,
  compareNoticeVersions,
  consentTextVersion,
  droppedReasonCodes,
  maintenanceSettingSchema,
  moderateReportSchema,
  noticeCurrentQuerySchema,
  noticeDraftSchema,
  noticeEditSchema,
  readSetting,
  reasonCodesFor,
  reasonCodesSettingSchema,
  settingSaveSchema,
  supportSettingSchema,
} from '../src/index';

/**
 * SETTINGS, PHASE 1 (2026-10-25). The pure rules: the schemas, the
 * fallbacks, the archive rule and the version order. Every refusal is checked
 * against its pinned sentence, never against the library's.
 */

const migration = readFileSync(
  fileURLToPath(
    new URL(
      '../../../prisma/migrations/20261025100000_settings_phase1/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

const reasonOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? null : (result.error?.issues[0]?.message ?? null);

/** 2026-10-27: phase 2 widened the known-key CHECK; the latest definition governs. */
const phase2Migration = readFileSync(
  fileURLToPath(
    new URL(
      '../../../prisma/migrations/20261027110100_settings_phase2/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('the database and the schemas name the same things', () => {
  it('the setting keys are the CHECK list', () => {
    const check = phase2Migration.match(/setting_version_key_known" CHECK \("key" IN \(([^)]*)\)/);
    expect(check, 'CHECK not found').not.toBeNull();
    const keys = [...(check?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(keys).toEqual([...SETTING_KEYS]);
  });

  it('the notice kinds are the CHECK list', () => {
    const check = migration.match(/notice_kind_known" CHECK \("kind" IN \(([^)]*)\)/);
    const kinds = [...(check?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(kinds).toEqual([...NOTICE_KINDS]);
  });

  it('the seeded reason codes are the defaults, and they validate', () => {
    const json = migration.match(/'reason_codes', 1, '([\s\S]*?)'::jsonb/)?.[1];
    expect(json, 'seed not found').toBeDefined();
    const seeded = JSON.parse(json ?? '{}');
    expect(seeded).toEqual(SETTING_DEFAULTS.reason_codes);
    expect(reasonCodesSettingSchema.safeParse(seeded).success).toBe(true);
  });

  it('every default validates against its own schema', () => {
    for (const key of SETTING_KEYS) {
      const parsed = settingSaveSchema.safeParse({
        key,
        expected_version: 0,
        value: SETTING_DEFAULTS[key],
      });
      expect(parsed.success, key).toBe(true);
    }
  });

  it('adds the audit keys this phase writes', () => {
    for (const key of [
      'setting.changed',
      'notice.drafted',
      'notice.draft_edited',
      'notice.draft_discarded',
      'notice.published',
      'notice.retired',
    ]) {
      expect(AUDIT_ACTIONS).toContain(key);
    }
  });
});

describe('saving a setting', () => {
  it('refuses an unknown key with the pinned sentence', () => {
    const result = settingSaveSchema.safeParse({ key: 'secrets', expected_version: 0, value: {} });
    expect(result.success).toBe(false);
    expect(reasonOf(result)).toBe(M.settingKeyUnknown);
  });

  it('requires the version the screen loaded, as a whole number', () => {
    const result = settingSaveSchema.safeParse({
      key: 'maintenance',
      expected_version: 1.5,
      value: { enabled: false, message: '' },
    });
    expect(reasonOf(result)).toBe(M.expectedVersionInvalid);
  });

  it('refuses a field the value may not carry', () => {
    const result = settingSaveSchema.safeParse({
      key: 'identity',
      expected_version: 0,
      value: { service_name: 'AgriOne', about: '', api_key: 'x' },
    });
    expect(result.success).toBe(false);
  });
});

describe('support contacts', () => {
  it('turns blanks into "not published"', () => {
    const parsed = supportSettingSchema.parse({ phone: ' ', email: '', whatsapp: '' });
    expect(parsed).toEqual({
      phone: null,
      email: null,
      whatsapp: null,
      office_hours: null,
      help_links: [],
    });
  });

  it('accepts a South Sudan number and a plain email', () => {
    const parsed = supportSettingSchema.parse({
      phone: '+211 912 345 678',
      email: 'Help@Example.org',
      whatsapp: '+211-922-000-111',
    });
    expect(parsed.phone).toBe('+211 912 345 678');
    expect(parsed.email).toBe('help@example.org');
  });

  it('refuses a number with letters and a malformed email', () => {
    expect(reasonOf(supportSettingSchema.safeParse({ phone: 'call me' }))).toBe(
      M.contactNumberInvalid,
    );
    expect(reasonOf(supportSettingSchema.safeParse({ email: 'not-an-email' }))).toBe(
      M.contactEmailInvalid,
    );
  });

  it('accepts https help links only', () => {
    for (const url of ['http://example.org', 'javascript:alert(1)', 'https//example.org']) {
      expect(
        reasonOf(supportSettingSchema.safeParse({ help_links: [{ label: 'Guide', url }] })),
        url,
      ).toBe(M.helpLinkUrlInvalid);
    }
    expect(
      supportSettingSchema.safeParse({
        help_links: [{ label: 'Guide', url: 'https://example.org/guide' }],
      }).success,
    ).toBe(true);
  });

  it('keeps to ten help links', () => {
    const links = Array.from({ length: 11 }, (_, i) => ({
      label: `Link ${i}`,
      url: `https://example.org/${i}`,
    }));
    expect(reasonOf(supportSettingSchema.safeParse({ help_links: links }))).toBe(
      M.helpLinksTooMany,
    );
  });
});

describe('the maintenance banner', () => {
  it('needs text to be switched on', () => {
    expect(reasonOf(maintenanceSettingSchema.safeParse({ enabled: true, message: '' }))).toBe(
      M.bannerRequired,
    );
    expect(maintenanceSettingSchema.safeParse({ enabled: false, message: '' }).success).toBe(true);
    expect(
      maintenanceSettingSchema.safeParse({ enabled: true, message: 'Down 18:00-19:00.' }).success,
    ).toBe(true);
  });
});

describe('reason codes', () => {
  const codes = SETTING_DEFAULTS.reason_codes;

  it('refuses the same code twice', () => {
    const twice = { codes: [...codes.codes, { ...codes.codes[0]! }] };
    expect(reasonOf(reasonCodesSettingSchema.safeParse(twice))).toBe(M.reasonCodeDuplicate);
  });

  it('refuses a malformed code and an empty applies-to', () => {
    const bad = (patch: object) => ({ codes: [{ ...codes.codes[0]!, ...patch }] });
    expect(reasonOf(reasonCodesSettingSchema.safeParse(bad({ code: 'Has Spaces' })))).toBe(
      M.reasonCodeInvalid,
    );
    expect(reasonOf(reasonCodesSettingSchema.safeParse(bad({ applies_to: [] })))).toBe(
      M.reasonAppliesToInvalid,
    );
  });

  it('names a code dropped by a save, and nothing when one is only archived', () => {
    const archived = {
      codes: codes.codes.map((c) => (c.code === 'other' ? { ...c, active: false } : c)),
    };
    expect(droppedReasonCodes(codes, archived)).toEqual([]);
    const dropped = { codes: codes.codes.filter((c) => c.code !== 'fraud_or_scam') };
    expect(droppedReasonCodes(codes, dropped)).toEqual(['fraud_or_scam']);
  });

  it('offers only active codes for the kind of decision asked', () => {
    const archived = {
      codes: codes.codes.map((c) => (c.code === 'other' ? { ...c, active: false } : c)),
    };
    const forAccount = reasonCodesFor(archived, 'account').map((c) => c.code);
    expect(forAccount).toContain('fraud_or_scam');
    expect(forAccount).not.toContain('misleading_listing');
    expect(forAccount).not.toContain('other');
    for (const target of REASON_TARGETS) {
      expect(reasonCodesFor(codes, target).length, target).toBeGreaterThan(0);
    }
  });

  it('a stored value that no longer fits falls back rather than half-reaching a page', () => {
    expect(readSetting('maintenance', { enabled: 'yes' })).toEqual(SETTING_DEFAULTS.maintenance);
    expect(readSetting('support', undefined)).toEqual(SETTING_DEFAULTS.support);
  });

  it('the dialogs may send a code beside the reason, and only a well-formed one', () => {
    const id = '7a1b2c3d-0000-4000-8000-000000000001';
    const base = { kind: 'farmer', id, reason: 'Fraud or scam: fake listings' };
    expect(accountSanctionSchema.safeParse({ ...base, reason_code: 'fraud_or_scam' }).success).toBe(
      true,
    );
    expect(accountSanctionSchema.safeParse(base).success).toBe(true);
    expect(accountSanctionSchema.safeParse({ ...base, reason_code: 'DROP TABLE' }).success).toBe(
      false,
    );
    expect(
      moderateReportSchema.safeParse({ action: 'dismiss', reason_code: 'duplicate_or_spam' })
        .success,
    ).toBe(true);
  });
});

describe('notices', () => {
  it('records consent versions as the sign-up screens always have', () => {
    expect(consentTextVersion('v1.3', 'en')).toBe('v1.3-en');
    expect(consentTextVersion('v1.3', 'ar')).toBe('v1.3-ar');
  });

  it('orders versions by number, not by text', () => {
    expect(compareNoticeVersions('v1.10', 'v1.9')).toBeGreaterThan(0);
    expect(compareNoticeVersions('v1.3', 'v1.3.0')).toBe(0);
    expect(compareNoticeVersions('v1.3', 'v2')).toBeLessThan(0);
  });

  it('validates a draft with the pinned sentences', () => {
    const draft = { kind: 'consent', language: 'en', version: 'v1.4', body: 'x'.repeat(40) };
    expect(noticeDraftSchema.safeParse(draft).success).toBe(true);
    expect(reasonOf(noticeDraftSchema.safeParse({ ...draft, version: '1.4' }))).toBe(
      M.noticeVersionInvalid,
    );
    expect(reasonOf(noticeDraftSchema.safeParse({ ...draft, body: 'short' }))).toBe(
      M.noticeBodyInvalid,
    );
    expect(reasonOf(noticeDraftSchema.safeParse({ ...draft, kind: 'cookie' }))).toBe(
      M.noticeKindUnknown,
    );
    expect(reasonOf(noticeDraftSchema.safeParse({ ...draft, language: 'fr' }))).toBe(
      M.noticeLanguageUnknown,
    );
  });

  it('refuses an edit that changes nothing', () => {
    expect(reasonOf(noticeEditSchema.safeParse({}))).toBe(M.noticeEditEmpty);
  });

  it('the version fits the consent record (32 characters) in either language', () => {
    expect(consentTextVersion('v999.999.999', 'ar').length).toBeLessThanOrEqual(32);
  });

  it('the public read asks for a kind and a language and nothing else', () => {
    expect(noticeCurrentQuerySchema.safeParse({ kind: 'consent', lang: 'ar' }).success).toBe(true);
    expect(
      noticeCurrentQuerySchema.safeParse({ kind: 'consent', lang: 'en', status: 'draft' }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PHASE 2 (2026-10-27)
// ---------------------------------------------------------------------------

describe('settings, phase 2', () => {
  const save = (key: string, value: unknown) =>
    settingSaveSchema.safeParse({ key, expected_version: 0, value });

  it('every fallback is what the code did before the setting existed', () => {
    expect(SETTING_DEFAULTS.registration_recovery).toEqual({
      code_resend_seconds: PHONE_CODE.resendSeconds,
      session_inactivity_minutes: RETURN_SESSION_INACTIVITY_MS / 60_000,
      minimum_age_years: null,
    });
    expect(SETTING_DEFAULTS.reference_lists.listing_validity_days).toBe(DEFAULT_VALIDITY_DAYS);
    expect(SETTING_DEFAULTS.profile_privacy).toEqual({
      show_phone_default: false,
      allow_messages_default: true,
    });
    expect(SETTING_DEFAULTS.language_region.enabled_languages).toEqual(['en', 'ar']);
  });

  it('English cannot be switched off', () => {
    expect(
      reasonOf(save('language_region', { enabled_languages: ['ar'], date_format: 'd_mmm_yyyy' })),
    ).toBe(M.languagesInvalid);
  });

  it('numbers stay inside their ranges, and the minimum age may be blank', () => {
    const base = SETTING_DEFAULTS.registration_recovery;
    expect(reasonOf(save('registration_recovery', { ...base, code_resend_seconds: 5 }))).toBe(
      M.wholeNumberInRange,
    );
    expect(save('registration_recovery', { ...base, minimum_age_years: 18 }).success).toBe(true);
    expect(save('registration_recovery', { ...base, minimum_age_years: null }).success).toBe(true);
  });

  it('there is no switch that closes self-service registration', () => {
    expect(
      save('registration_recovery', {
        ...SETTING_DEFAULTS.registration_recovery,
        self_registration: false,
      }).success,
    ).toBe(false);
  });

  it('a reminder comes before the listing ends, and a list cannot be archived entirely', () => {
    const base = SETTING_DEFAULTS.reference_lists;
    expect(
      reasonOf(save('reference_lists', { ...base, listing_validity_days: 7, listing_reminder_days: 7 })),
    ).toBe(M.reminderAfterValidity);
    expect(reasonOf(save('reference_lists', { ...base, archived_units: [...LISTING_UNITS] }))).toBe(
      M.archiveAll,
    );
    expect(reasonOf(save('reference_lists', { ...base, archived_units: ['tonne'] }))).toBe(
      M.unitUnknown,
    );
  });

  it('an archived category or unit is refused for a new post, by name', () => {
    const lists = { archived_categories: ['fish'], archived_units: ['tin'] } as Parameters<
      typeof archivedChoice
    >[0];
    expect(archivedChoice(lists, { category: 'fish' })).toBe('category');
    expect(archivedChoice(lists, { category: 'crop', unit: 'kg', price_per: 'tin' })).toBe('unit');
    expect(archivedChoice(lists, { category: 'crop', unit: 'kg' })).toBeNull();
  });

  it('the minimum age reads the year of birth generously, and blank means none', () => {
    const now = new Date('2026-10-27T00:00:00Z');
    expect(meetsMinimumAge(2008, 18, now)).toBe(true);
    expect(meetsMinimumAge(2009, 18, now)).toBe(false);
    expect(meetsMinimumAge(2020, null, now)).toBe(true);
  });

  it('the SMS cost is optional and bounded', () => {
    const base = SETTING_DEFAULTS.notifications_moderation;
    expect(save('notifications_moderation', { ...base, sms_cost_per_segment_usd: 0.04 }).success).toBe(
      true,
    );
    expect(
      reasonOf(save('notifications_moderation', { ...base, sms_cost_per_segment_usd: 3 })),
    ).toBe(M.smsCostInvalid);
  });

  it('the phase-2 migration keeps every phase-1 key, in order', () => {
    const check = phase2Migration.match(/setting_version_key_known" CHECK \("key" IN \(([^)]*)\)/);
    const keys = [...(check?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(keys.slice(0, 4)).toEqual(['identity', 'support', 'maintenance', 'reason_codes']);
  });
});
