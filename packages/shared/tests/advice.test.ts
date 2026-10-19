import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ADVICE_LANGUAGES,
  ADVICE_MESSAGES,
  ADVICE_OUTCOMES,
  ADVICE_OUTCOMES_BY_SIDE,
  ADVICE_TOPICS,
  adviceCaseCreateSchema,
  adviceCasePatchSchema,
  adviceProviderFilterSchema,
  adviceProviderSchema,
  startConversationSchema,
} from '../src';

/**
 * INDEPENDENT ADVICE (2026-10-22): the shapes the advice routes accept, and
 * the lists the database checks, held to each other.
 */

const ID = '7a1b2c3d-0000-4000-8000-000000000001';
const PROVIDER = '7a1b2c3d-0000-4000-8000-000000000002';

const migration = readFileSync(
  fileURLToPath(
    new URL(
      '../../../prisma/migrations/20261022090000_advice_requests/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

/** The quoted words inside the named CHECK constraint. */
function checkValues(name: string): string[] {
  const at = migration.indexOf(`"${name}"`);
  expect(at, `${name} missing from the migration`).toBeGreaterThan(-1);
  const body = migration.slice(at, migration.indexOf('),', at) + 1);
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe('the database checks the same lists as the schemas', () => {
  it('topics, on providers and on cases', () => {
    expect(checkValues('advice_provider_topics_known')).toEqual([...ADVICE_TOPICS]);
    expect(checkValues('advice_case_topic_known')).toEqual([...ADVICE_TOPICS]);
  });
  it('languages and outcomes', () => {
    expect(checkValues('advice_provider_languages_known')).toEqual([...ADVICE_LANGUAGES]);
    expect(checkValues('advice_case_outcome_known')).toEqual([...ADVICE_OUTCOMES]);
  });
  it('a conversation may be about an advice case, and the migration writes no audit CHECK', () => {
    expect(migration).toMatch(/'advice_case'\)\);/);
    expect(migration).not.toMatch(/ADD CONSTRAINT "audit_event_action_known"/);
  });
});

const profile = {
  display_name: 'Juba Soil Clinic',
  provider_kind: 'advisory_organization',
  description: 'Soil testing and fertiliser advice for smallholders.',
  topics: ['soil_fertiliser', 'crops'],
  languages: ['en', 'juba_arabic'],
  delivery_modes: ['remote'],
  terms: 'free',
};

describe('an advice profile', () => {
  it('is a draft covering anywhere unless said otherwise, with blank text stored as nothing', () => {
    const parsed = adviceProviderSchema.parse({ ...profile, fee_note: '  ' });
    expect(parsed.status).toBe('draft');
    expect(parsed.state_ids).toEqual([]);
    expect(parsed.fee_note).toBeNull();
    expect(parsed.commercial_interests).toBeNull();
  });
  it('needs at least one topic, language and way of giving advice, each from the list', () => {
    const none = adviceProviderSchema.safeParse({ ...profile, topics: [] });
    expect(none.error?.issues[0]?.message).toBe(ADVICE_MESSAGES.topicsRequired);
    const odd = adviceProviderSchema.safeParse({ ...profile, languages: ['klingon'] });
    expect(odd.error?.issues[0]?.message).toBe(ADVICE_MESSAGES.languageUnknown);
    const mode = adviceProviderSchema.safeParse({ ...profile, delivery_modes: [] });
    expect(mode.error?.issues[0]?.message).toBe(ADVICE_MESSAGES.deliveryRequired);
  });
  it('keeps each choice once', () => {
    expect(adviceProviderSchema.parse({ ...profile, topics: ['crops', 'crops'] }).topics).toEqual([
      'crops',
    ]);
  });
  it('refuses a field it does not know, such as a phone', () => {
    expect(adviceProviderSchema.safeParse({ ...profile, phone: '+211912345678' }).success).toBe(
      false,
    );
  });
  it('filters the directory by the same lists', () => {
    expect(
      adviceProviderFilterSchema.safeParse({ topic: 'crops', delivery_mode: 'remote' }).success,
    ).toBe(true);
    expect(adviceProviderFilterSchema.safeParse({ topic: 'astrology' }).success).toBe(false);
  });
});

describe('an advice request', () => {
  const ask = {
    id: ID,
    provider_id: PROVIDER,
    topic: 'crops',
    question: 'My sorghum leaves are yellow.',
  };

  it('shares nothing unless the person ticks it, and is answered in the app by default', () => {
    const parsed = adviceCaseCreateSchema.parse(ask);
    expect(parsed.share_details).toBe(false);
    expect(parsed.preferred_contact).toBe('in_app');
  });
  it('asks for the tick before a call or an SMS, which need the number', () => {
    const call = adviceCaseCreateSchema.safeParse({ ...ask, preferred_contact: 'phone' });
    expect(call.error?.issues[0]?.message).toBe(ADVICE_MESSAGES.contactNeedsShare);
    expect(
      adviceCaseCreateSchema.safeParse({ ...ask, preferred_contact: 'sms', share_details: true })
        .success,
    ).toBe(true);
  });
  it('carries an id made on the phone, and a real question', () => {
    expect(adviceCaseCreateSchema.safeParse({ ...ask, id: undefined }).success).toBe(false);
    const short = adviceCaseCreateSchema.safeParse({ ...ask, question: 'Help' });
    expect(short.error?.issues[0]?.message).toBe(ADVICE_MESSAGES.questionInvalid);
  });
  it('cannot be started through the ordinary messaging route', () => {
    const viaMessages = startConversationSchema.safeParse({
      post_kind: 'advice_case',
      post_id: PROVIDER,
      message_id: ID,
      body: 'Hello',
    });
    expect(viaMessages.success).toBe(false);
  });
});

describe('a change to a request', () => {
  it('closes with an outcome, and nothing else', () => {
    expect(adviceCasePatchSchema.safeParse({ action: 'close', outcome: 'resolved' }).success).toBe(
      true,
    );
    const bare = adviceCasePatchSchema.safeParse({ action: 'close' });
    expect(bare.error?.issues[0]?.message).toBe(ADVICE_MESSAGES.outcomeUnknown);
    const extra = adviceCasePatchSchema.safeParse({ action: 'start', rating: 5 });
    expect(extra.error?.issues[0]?.message).toBe(ADVICE_MESSAGES.fieldNotForAction);
  });
  it('rates from one to five whole stars', () => {
    expect(adviceCasePatchSchema.safeParse({ action: 'feedback', rating: 4 }).success).toBe(true);
    for (const rating of [0, 6, 2.5]) {
      const bad = adviceCasePatchSchema.safeParse({ action: 'feedback', rating });
      expect(bad.error?.issues[0]?.message).toBe(ADVICE_MESSAGES.ratingInvalid);
    }
  });
  it('gives each side its own outcomes, and every outcome to one side or the other', () => {
    expect(ADVICE_OUTCOMES_BY_SIDE.requester).toContain('cancelled');
    expect(ADVICE_OUTCOMES_BY_SIDE.provider).toContain('referred');
    expect(ADVICE_OUTCOMES_BY_SIDE.provider).not.toContain('resolved');
    const either = new Set([
      ...ADVICE_OUTCOMES_BY_SIDE.requester,
      ...ADVICE_OUTCOMES_BY_SIDE.provider,
    ]);
    expect([...either].sort()).toEqual([...ADVICE_OUTCOMES].sort());
  });
});
