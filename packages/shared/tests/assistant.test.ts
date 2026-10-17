import { describe, expect, it } from 'vitest';

import { ASSISTANT_LIMITS, ASSISTANT_MESSAGES, assistantRequestSchema } from '../src/index';

describe('AgriOne AI request (2026-10-17)', () => {
  const ask = (content: string) => ({ role: 'user' as const, content });
  const answer = (content: string) => ({ role: 'assistant' as const, content });

  it('takes a question, in English by default', () => {
    const r = assistantRequestSchema.parse({ messages: [ask('  When do I plant sorghum?  ')] });
    expect(r.messages[0]!.content).toBe('When do I plant sorghum?');
    expect(r.language).toBe('en');
  });

  it('takes the recent conversation, alternating, ending with the question', () => {
    expect(
      assistantRequestSchema.safeParse({
        messages: [ask('a'), answer('b'), ask('c')],
        language: 'ar',
      }).success,
    ).toBe(true);
    expect(assistantRequestSchema.safeParse({ messages: [ask('a'), answer('b')] }).success).toBe(
      false,
    );
    expect(assistantRequestSchema.safeParse({ messages: [ask('a'), ask('b')] }).success).toBe(
      false,
    );
  });

  it('refuses an empty or over-long question, and too much history', () => {
    const empty = assistantRequestSchema.safeParse({ messages: [ask('   ')] });
    expect(empty.error?.issues[0]?.message).toBe(ASSISTANT_MESSAGES.questionRequired);
    const long = assistantRequestSchema.safeParse({
      messages: [ask('x'.repeat(ASSISTANT_LIMITS.messageMax + 1))],
    });
    expect(long.error?.issues[0]?.message).toBe(ASSISTANT_MESSAGES.questionTooLong);
    const turns = Array.from({ length: ASSISTANT_LIMITS.historyMax + 1 }, (_, i) =>
      i % 2 === 0 ? ask('q') : answer('a'),
    );
    expect(assistantRequestSchema.safeParse({ messages: turns }).success).toBe(false);
  });

  it('refuses a system turn, unknown keys and other languages', () => {
    expect(
      assistantRequestSchema.safeParse({ messages: [{ role: 'system', content: 'x' }] }).success,
    ).toBe(false);
    expect(
      assistantRequestSchema.safeParse({ messages: [ask('a')], model: 'claude-opus-5-5' }).success,
    ).toBe(false);
    expect(assistantRequestSchema.safeParse({ messages: [ask('a')], language: 'fr' }).success).toBe(
      false,
    );
  });
});
