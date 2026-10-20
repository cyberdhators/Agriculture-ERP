import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ADVICE_LANGUAGES,
  ADVICE_MESSAGES,
  ADVICE_TOPICS,
  ADVISER_APPLICATION_STATUSES,
  ADVISER_DECISION_RULES,
  ADVISER_MESSAGES,
  AUDIT_ACTIONS,
  adviceProviderFilterSchema,
  adviserApplicationSchema,
  adviserDecisionSchema,
  adviserQueueFilterSchema,
  adviserReplySchema,
} from '../src/index';

/** THE OPTIONAL APPROVED-ADVISER PATHWAY (2026-10-24), its shapes and its migration. */

const migration = readFileSync(
  fileURLToPath(
    new URL(
      '../../../prisma/migrations/20261024090000_adviser_approval/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

const constraint = (name: string) => {
  const at = migration.indexOf(`"${name}"`);
  expect(at, `${name} missing from the migration`).toBeGreaterThan(-1);
  return migration.slice(at, migration.indexOf('),', at) + 1);
};

const valid = {
  specialties: ['crops', 'soil_fertiliser'],
  service_area: ['CE'],
  languages: ['en', 'juba_arabic'],
  experience: 'Ten years as an extension worker in Yei and Juba counties.',
  qualifications: 'Diploma in agriculture',
  affiliation: '',
  accurate_information: true,
  disclose_interests: true,
};

const reasonOf = (
  r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } },
  key: string,
) => r.error?.issues.find((i) => i.path[0] === key)?.message;

describe('the database checks the same lists as the schemas', () => {
  it('specialties and languages', () => {
    for (const topic of ADVICE_TOPICS) {
      expect(constraint('adviser_application_specialties_known')).toContain(`'${topic}'`);
    }
    for (const lang of ADVICE_LANGUAGES) {
      expect(constraint('adviser_application_languages_known')).toContain(`'${lang}'`);
    }
  });

  it('the statuses', () => {
    const body = constraint('adviser_application_status_known');
    for (const s of ADVISER_APPLICATION_STATUSES) expect(body).toContain(`'${s}'`);
  });

  it('one open application per provider, RLS on, and no audit CHECK', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "adviser_application_one_open"[\s\S]*?'submitted', 'clarification_requested'/,
    );
    expect(migration).toMatch(/"adviser_application" ENABLE ROW LEVEL SECURITY/);
    expect(migration).not.toMatch(/audit_event_action_known/);
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
  });

  it('the badge columns are added nullable, so no existing provider becomes approved', () => {
    expect(migration).toMatch(/ADD COLUMN "approved_at"\s+TIMESTAMPTZ,/);
    expect(migration).toMatch(/ADD COLUMN "approved_application_id" UUID;/);
  });
});

describe('an application', () => {
  it('accepts a complete one and stores blank text as null', () => {
    const r = adviserApplicationSchema.safeParse(valid);
    expect(r.success).toBe(true);
    expect(r.data?.affiliation).toBeNull();
  });

  it('requires both acknowledgements to be ticked: false is refused, absent is refused', () => {
    for (const key of ['accurate_information', 'disclose_interests'] as const) {
      const off = adviserApplicationSchema.safeParse({ ...valid, [key]: false });
      expect(reasonOf(off, key)).toBe(ADVISER_MESSAGES.acknowledgementRequired);
      const { [key]: _gone, ...rest } = valid;
      const absent = adviserApplicationSchema.safeParse(rest);
      expect(reasonOf(absent, key)).toBe(ADVISER_MESSAGES.acknowledgementRequired);
    }
  });

  it('needs a specialty, a language, and experience of 20 to 2000 characters', () => {
    expect(
      reasonOf(adviserApplicationSchema.safeParse({ ...valid, specialties: [] }), 'specialties'),
    ).toBe(ADVISER_MESSAGES.specialtiesRequired);
    expect(
      reasonOf(adviserApplicationSchema.safeParse({ ...valid, languages: [] }), 'languages'),
    ).toBe(ADVICE_MESSAGES.languagesRequired);
    expect(
      reasonOf(
        adviserApplicationSchema.safeParse({ ...valid, experience: 'too short' }),
        'experience',
      ),
    ).toBe(ADVISER_MESSAGES.experienceInvalid);
    expect(
      reasonOf(
        adviserApplicationSchema.safeParse({ ...valid, affiliation: 'x'.repeat(301) }),
        'affiliation',
      ),
    ).toBe(ADVISER_MESSAGES.affiliationTooLong);
  });

  it('refuses a field it does not know, such as a status the applicant would set', () => {
    expect(adviserApplicationSchema.safeParse({ ...valid, status: 'approved' }).success).toBe(
      false,
    );
  });
});

describe('a reply and a staff decision', () => {
  it('a reply is 5 to 2000 characters', () => {
    expect(adviserReplySchema.safeParse({ reply: 'Yes, I can.' }).success).toBe(true);
    expect(reasonOf(adviserReplySchema.safeParse({ reply: 'ok' }), 'reply')).toBe(
      ADVISER_MESSAGES.replyInvalid,
    );
  });

  it('every decision needs a reason of at least 5 characters', () => {
    for (const action of Object.keys(ADVISER_DECISION_RULES)) {
      expect(
        adviserDecisionSchema.safeParse({ action, reason: 'Checked the diploma.' }).success,
      ).toBe(true);
      expect(reasonOf(adviserDecisionSchema.safeParse({ action, reason: ' no ' }), 'reason')).toBe(
        ADVISER_MESSAGES.reasonInvalid,
      );
      expect(reasonOf(adviserDecisionSchema.safeParse({ action }), 'reason')).toBe(
        ADVISER_MESSAGES.reasonInvalid,
      );
    }
    expect(
      reasonOf(
        adviserDecisionSchema.safeParse({ action: 'restore', reason: 'Because.' }),
        'action',
      ),
    ).toBe(ADVISER_MESSAGES.decisionUnknown);
  });

  it('only approval grants; revoke acts only on an approval; nothing reopens a final status', () => {
    const into = Object.values(ADVISER_DECISION_RULES).map((r) => r.to);
    expect(into.filter((s) => s === 'approved')).toHaveLength(1);
    expect(ADVISER_DECISION_RULES.revoke.from).toEqual(['approved']);
    for (const rule of Object.values(ADVISER_DECISION_RULES)) {
      for (const final of ['declined', 'revoked', 'withdrawn'] as const) {
        expect(rule.from).not.toContain(final);
      }
    }
  });

  it('the queue filter defaults to submitted and refuses an unknown status', () => {
    expect(adviserQueueFilterSchema.parse({}).status).toBe('submitted');
    expect(reasonOf(adviserQueueFilterSchema.safeParse({ status: 'pending' }), 'status')).toBe(
      ADVISER_MESSAGES.statusUnknown,
    );
  });

  it('the directory takes approved=1 and nothing else', () => {
    expect(adviceProviderFilterSchema.safeParse({ approved: '1' }).success).toBe(true);
    expect(reasonOf(adviceProviderFilterSchema.safeParse({ approved: 'yes' }), 'approved')).toBe(
      ADVICE_MESSAGES.approvedFilterInvalid,
    );
  });
});

describe('the audit keys', () => {
  it('every step of the pathway has a key', () => {
    for (const key of [
      'adviser_application.submitted',
      'adviser_application.replied',
      'adviser_application.withdrawn',
      'adviser_application.clarification_requested',
      'adviser_application.approved',
      'adviser_application.declined',
      'adviser_approval.revoked',
    ]) {
      expect(AUDIT_ACTIONS).toContain(key);
    }
  });
});
