import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_CHANNELS,
  ANNOUNCEMENT_MESSAGES as M,
  ANNOUNCEMENT_SCOPES,
  ANNOUNCEMENT_STATUSES,
  AUDIT_ACTIONS,
  DEFAULT_PREFERENCES,
  DELIVERY_SKIP_REASONS,
  DELIVERY_STATUSES,
  NAME_FALLBACK,
  PERMISSION_KEYS,
  PRESET_PERMISSIONS,
  RECIPIENT_KINDS,
  TEMPLATE_STATUSES,
  announcementDraftSchema,
  announcementSendSchema,
  effectivePermissions,
  holdsPermission,
  notificationPreferencesSchema,
  preferenceAllows,
  remainingDeliveries,
  renderMessage,
  smsCost,
  smsEstimate,
  tallyDeliveries,
  templateCreateSchema,
  templateEditSchema,
  unknownPlaceholders,
} from '../src/index';

/**
 * OFFICIAL ANNOUNCEMENTS (2026-10-27). The pure rules: the lists the database
 * checks, the schemas, the placeholder renderer, the preference rule, the SMS
 * estimate and cost, and the delivery tallies. No database, no provider: no
 * test here, or anywhere, sends an SMS.
 */

const migration = readFileSync(
  fileURLToPath(
    new URL('../../../prisma/migrations/20261027110000_communications/migration.sql', import.meta.url),
  ),
  'utf8',
);

const checkList = (name: string): string[] => {
  const at = migration.indexOf(`"${name}" CHECK`);
  expect(at, `${name} not found`).toBeGreaterThan(-1);
  const body = migration.slice(at, migration.indexOf(')', migration.indexOf('IN (', at)) + 1);
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
};

const reasonOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? null : (result.error?.issues[0]?.message ?? null);

const draft = (over: Record<string, unknown> = {}) => ({
  title: 'Market day on Friday',
  body: 'Hello {name}, the market in Juba opens early on Friday.',
  category: 'announcement',
  channels: ['in_app'],
  scope: { kind: 'all' },
  ...over,
});

describe('the database and the shared lists name the same things', () => {
  it('channels, statuses, categories, scopes, kinds and skip reasons', () => {
    expect(checkList('message_template_channel_known')).toEqual([...ANNOUNCEMENT_CHANNELS]);
    expect(checkList('message_template_status_known')).toEqual([...TEMPLATE_STATUSES]);
    expect(checkList('announcement_category_known')).toEqual([...ANNOUNCEMENT_CATEGORIES]);
    expect(checkList('announcement_scope_known')).toEqual([...ANNOUNCEMENT_SCOPES]);
    expect(checkList('announcement_status_known')).toEqual([...ANNOUNCEMENT_STATUSES]);
    expect(checkList('announcement_delivery_channel_known')).toEqual([...ANNOUNCEMENT_CHANNELS]);
    expect(checkList('announcement_delivery_recipient_known')).toEqual([...RECIPIENT_KINDS]);
    expect(checkList('announcement_delivery_status_known')).toEqual([...DELIVERY_STATUSES]);
    const skip = migration.slice(migration.indexOf('"announcement_delivery_skip_reason"'));
    const reasons = [...skip.slice(0, skip.indexOf('),\n')).matchAll(/'([a-z_]+)'/g)]
      .map((m) => m[1])
      .filter((r) => r !== 'skipped');
    expect(reasons).toEqual([...DELIVERY_SKIP_REASONS]);
  });

  it('every new table has row-level security and no policy', () => {
    for (const table of [
      'message_template',
      'announcement',
      'announcement_delivery',
      'notification_preference',
    ]) {
      expect(migration).toContain(`ALTER TABLE "public"."${table}" ENABLE ROW LEVEL SECURITY`);
    }
    expect(migration).not.toMatch(/CREATE POLICY/);
  });

  it('stores no phone number, address or message text on a delivery row', () => {
    const delivery = migration.slice(
      migration.indexOf('CREATE TABLE "public"."announcement_delivery"'),
      migration.indexOf('CREATE UNIQUE INDEX "announcement_delivery_once"'),
    );
    expect(delivery).not.toMatch(/"phone"|"email"|"address"|"body"|"text"/);
  });

  it('adds the audit keys these routes write', () => {
    for (const key of [
      'message_template.created',
      'message_template.updated',
      'message_template.status_changed',
      'announcement.drafted',
      'announcement.draft_edited',
      'announcement.draft_discarded',
      'announcement.queued',
      'announcement.batch_sent',
      'announcement.retry_queued',
      'announcement.completed',
      'notification_preference.updated',
    ]) {
      expect(AUDIT_ACTIONS).toContain(key);
    }
  });
});

describe('the communications permission', () => {
  it('exists, and the Administrator preset carries it', () => {
    expect(PERMISSION_KEYS).toContain('communications.send');
    expect(PRESET_PERMISSIONS.administrator).toContain('communications.send');
  });

  it('is not carried by Moderator + Editor, Analyst or Support', () => {
    for (const preset of ['moderator_editor', 'analyst', 'support'] as const) {
      expect(PRESET_PERMISSIONS[preset]).not.toContain('communications.send');
    }
  });

  it('an existing administrator holds it; a supervisor without a grant does not', () => {
    expect(
      holdsPermission(effectivePermissions({ role: 'admin', grants: [] }), 'communications.send'),
    ).toBe(true);
    expect(
      holdsPermission(
        effectivePermissions({ role: 'supervisor', grants: [] }),
        'communications.send',
      ),
    ).toBe(false);
  });
});

describe('placeholders', () => {
  it('allows {name} and {service_name} and nothing else', () => {
    expect(unknownPlaceholders('Hi {name}, from {service_name}')).toEqual([]);
    expect(unknownPlaceholders('Hi {phone} {Name}')).toEqual(['{phone}', '{Name}']);
  });

  it('renders the first name, cut to 20 characters, or "friend"', () => {
    const s = { service_name: 'AgriOne South Sudan' };
    expect(renderMessage('Hi {name}, {service_name}', { ...s, name: 'Amina' })).toBe(
      'Hi Amina, AgriOne South Sudan',
    );
    expect(renderMessage('{name}', { ...s, name: 'x'.repeat(30) })).toBe('x'.repeat(20));
    expect(renderMessage('{name}', { ...s, name: '  ' })).toBe(NAME_FALLBACK);
    expect(renderMessage('{name}', { ...s, name: null })).toBe(NAME_FALLBACK);
  });

  it('a draft or template with an unknown placeholder is refused with the pinned sentence', () => {
    expect(reasonOf(announcementDraftSchema.safeParse(draft({ body: 'Your {phone}' })))).toBe(
      M.placeholderUnknown,
    );
    expect(
      reasonOf(templateCreateSchema.safeParse({ name: 'Bad', channel: 'sms', body: '{x}' })),
    ).toBe(M.placeholderUnknown);
  });
});

describe('an announcement draft', () => {
  it('accepts a plain in-app announcement to all accounts', () => {
    const parsed = announcementDraftSchema.parse(draft());
    expect(parsed.scope).toEqual({ kind: 'all', state_id: null, activity: null });
    expect(parsed.sms_body).toBeNull();
    expect(parsed.template_id).toBeNull();
  });

  it('orders and de-duplicates the channels', () => {
    const parsed = announcementDraftSchema.parse(
      draft({ channels: ['email', 'in_app', 'email'] }),
    );
    expect(parsed.channels).toEqual(['in_app', 'email']);
  });

  it('needs SMS text when SMS is chosen, within three parts', () => {
    expect(reasonOf(announcementDraftSchema.safeParse(draft({ channels: ['sms'] })))).toBe(
      M.smsBodyRequired,
    );
    expect(
      reasonOf(
        announcementDraftSchema.safeParse(draft({ channels: ['sms'], sms_body: 'a'.repeat(460) })),
      ),
    ).toBe(M.smsTooLong);
    expect(
      announcementDraftSchema.safeParse(draft({ channels: ['sms'], sms_body: 'Market Friday.' }))
        .success,
    ).toBe(true);
  });

  it('a state scope names its state, an activity scope its activity, and no other', () => {
    expect(reasonOf(announcementDraftSchema.safeParse(draft({ scope: { kind: 'state' } })))).toBe(
      M.scopeStateRequired,
    );
    expect(
      reasonOf(announcementDraftSchema.safeParse(draft({ scope: { kind: 'activity' } }))),
    ).toBe(M.scopeActivityRequired);
    expect(
      reasonOf(announcementDraftSchema.safeParse(draft({ scope: { kind: 'all', state_id: 'CE' } }))),
    ).toBe(M.scopeExtraField);
    expect(
      announcementDraftSchema.safeParse(draft({ scope: { kind: 'state', state_id: 'CE' } }))
        .success,
    ).toBe(true);
  });

  it('staff are reached by email only, officers by SMS only', () => {
    expect(reasonOf(announcementDraftSchema.safeParse(draft({ scope: { kind: 'staff' } })))).toBe(
      M.staffEmailOnly,
    );
    expect(
      reasonOf(
        announcementDraftSchema.safeParse(
          draft({ scope: { kind: 'officers' }, channels: ['sms', 'in_app'], sms_body: 'Hi' }),
        ),
      ),
    ).toBe(M.officersSmsOnly);
  });

  it('refuses an unknown field', () => {
    expect(announcementDraftSchema.safeParse(draft({ recipient_ids: [] })).success).toBe(false);
  });
});

describe('sending', () => {
  it('needs the confirmation and the previewed count', () => {
    expect(reasonOf(announcementSendSchema.safeParse({ expected_recipients: 3 }))).toBe(
      M.confirmRequired,
    );
    expect(
      reasonOf(announcementSendSchema.safeParse({ confirm: true, expected_recipients: 1.5 })),
    ).toBe(M.expectedRecipientsInvalid);
    expect(announcementSendSchema.safeParse({ confirm: true, expected_recipients: 3 }).success).toBe(
      true,
    );
  });
});

describe('templates', () => {
  it('an SMS template has no title; in-app and email need one', () => {
    expect(
      reasonOf(
        templateCreateSchema.safeParse({ name: 'Sms', channel: 'sms', title: 'Hello there', body: 'Hi' }),
      ),
    ).toBe(M.titleNotForSms);
    expect(
      reasonOf(templateCreateSchema.safeParse({ name: 'Email', channel: 'email', body: 'Hi' })),
    ).toBe(M.titleInvalid);
    expect(
      templateCreateSchema.safeParse({ name: 'Email', channel: 'email', title: 'Hello', body: 'Hi' })
        .success,
    ).toBe(true);
  });

  it('an edit changes something, and never the channel', () => {
    expect(reasonOf(templateEditSchema.safeParse({}))).toBe(M.templateEditEmpty);
    expect(templateEditSchema.safeParse({ channel: 'sms' }).success).toBe(false);
    expect(templateEditSchema.safeParse({ status: 'archived' }).success).toBe(true);
  });
});

describe('preferences', () => {
  it('no row means everything is on', () => {
    for (const c of ANNOUNCEMENT_CHANNELS) {
      expect(preferenceAllows('announcement', c, null)).toBe(true);
    }
  });

  it('a switched-off channel is not used for an announcement', () => {
    const p = { ...DEFAULT_PREFERENCES, announcements_sms: false };
    expect(preferenceAllows('announcement', 'sms', p)).toBe(false);
    expect(preferenceAllows('announcement', 'in_app', p)).toBe(true);
  });

  it('an essential message ignores preferences: it cannot be switched off', () => {
    const off = {
      announcements_in_app: false,
      announcements_sms: false,
      announcements_email: false,
      updates_in_app: false,
    };
    for (const c of ANNOUNCEMENT_CHANNELS) expect(preferenceAllows('essential', c, off)).toBe(true);
  });

  it('the preferences body has exactly the four switches, each on or off', () => {
    expect(notificationPreferencesSchema.safeParse(DEFAULT_PREFERENCES).success).toBe(true);
    expect(
      reasonOf(notificationPreferencesSchema.safeParse({ ...DEFAULT_PREFERENCES, updates_in_app: 'no' })),
    ).toBe(M.preferenceInvalid);
    expect(
      notificationPreferencesSchema.safeParse({ ...DEFAULT_PREFERENCES, essential: false }).success,
    ).toBe(false);
  });
});

describe('SMS estimate and cost', () => {
  it('counts {name} at its full 20 characters', () => {
    // 141 plain characters + a 20-character name = 161: two parts.
    expect(smsEstimate(`${'a'.repeat(141)}{name}`, 'AgriOne').segments).toBe(2);
    expect(smsEstimate(`${'a'.repeat(140)}{name}`, 'AgriOne').segments).toBe(1);
  });

  it('multiplies parts by messages and states no cost when none is set', () => {
    expect(smsCost(100, 2, null)).toEqual({ total_segments: 200, estimated_cost_usd: null });
    expect(smsCost(100, 2, 0.035)).toEqual({ total_segments: 200, estimated_cost_usd: 7 });
  });
});

describe('delivery tallies', () => {
  it('folds rows into a channel-by-status table and counts what remains', () => {
    const counts = tallyDeliveries([
      { channel: 'sms', status: 'queued', n: 5 },
      { channel: 'sms', status: 'sent', n: 3 },
      { channel: 'in_app', status: 'sending', n: 2 },
      { channel: 'email', status: 'skipped', n: 1 },
      { channel: 'nonsense', status: 'sent', n: 9 },
    ]);
    expect(counts.sms.queued).toBe(5);
    expect(counts.sms.sent).toBe(3);
    expect(counts.email.skipped).toBe(1);
    expect(remainingDeliveries(counts)).toBe(7);
  });
});
