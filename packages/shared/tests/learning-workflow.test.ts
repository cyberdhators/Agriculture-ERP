import { describe, expect, it } from 'vitest';

import {
  ADVICE_TOPICS,
  ADVICE_TOPIC_FOR_LEARNING_TOPIC,
  LEARNING_ACTIONS,
  LEARNING_ACTION_NEEDS_PUBLISH,
  LEARNING_STATUSES,
  LEARNING_TOPICS,
  LEARNING_TOPIC_FOR_ADVICE_TOPIC,
  LEARNING_WORKFLOW_MESSAGES,
  learningEditNeedsPublish,
  learningResourceInputSchema,
  learningTransition,
  learningTransitionSchema,
  publicGuideFilterSchema,
} from '../src/index';

/**
 * Advice & Learning: draft -> review -> publish (2026-10-22). The rules the
 * routes ask, tested without a database.
 */

const card = {
  title: 'Sorghum planting guide',
  topics: ['crops'],
  language: 'en',
  format: 'pdf',
  storage_path: 'learning/2026/sorghum-planting.pdf',
  byte_size: 812_000,
};

const reason = (
  schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } },
  input: unknown,
  field: string,
): string | undefined => {
  const result = schema.safeParse(input) as {
    success: boolean;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  };
  if (result.success) return undefined;
  return result.error?.issues.find((i) => i.path.join('.') === field)?.message;
};

describe('the moves', () => {
  it('opens exactly the documented moves from each state', () => {
    const open = Object.fromEntries(
      LEARNING_STATUSES.map((s) => [
        s,
        LEARNING_ACTIONS.filter((a) => learningTransition(s, a) !== null),
      ]),
    );
    expect(open).toEqual({
      draft: ['submit'],
      in_review: ['return', 'publish'],
      published: ['unpublish'],
      unpublished: ['submit', 'publish'],
    });
  });

  it('lands each move where it says', () => {
    expect(learningTransition('draft', 'submit')).toBe('in_review');
    expect(learningTransition('in_review', 'return')).toBe('draft');
    expect(learningTransition('in_review', 'publish')).toBe('published');
    expect(learningTransition('unpublished', 'publish')).toBe('published');
    expect(learningTransition('published', 'unpublish')).toBe('unpublished');
  });

  it('never publishes a draft straight away: it goes through review', () => {
    expect(learningTransition('draft', 'publish')).toBeNull();
  });
});

describe('publishing authority is separately assignable', () => {
  it('only submitting is open to an editor without publishing authority', () => {
    expect(LEARNING_ACTIONS.filter((a) => !LEARNING_ACTION_NEEDS_PUBLISH[a])).toEqual(['submit']);
  });

  it('a guide in review or public is edited only with publishing authority', () => {
    expect(LEARNING_STATUSES.filter(learningEditNeedsPublish)).toEqual(['in_review', 'published']);
  });
});

describe('topics', () => {
  it('maps every library shelf to an advice topic and back onto a real shelf', () => {
    for (const t of LEARNING_TOPICS) {
      expect(ADVICE_TOPICS).toContain(ADVICE_TOPIC_FOR_LEARNING_TOPIC[t]);
    }
    for (const a of ADVICE_TOPICS) {
      expect(LEARNING_TOPICS).toContain(LEARNING_TOPIC_FOR_ADVICE_TOPIC[a]);
    }
  });

  it('a shelf survives the round trip', () => {
    for (const t of LEARNING_TOPICS) {
      expect(LEARNING_TOPIC_FOR_ADVICE_TOPIC[ADVICE_TOPIC_FOR_LEARNING_TOPIC[t]]).toBe(t);
    }
  });

  it('accepts topics without the old shelf, and the old shelf without topics', () => {
    expect(learningResourceInputSchema.safeParse(card).success).toBe(true);
    const noTopics = { ...card, topics: undefined };
    expect(
      learningResourceInputSchema.safeParse({ ...noTopics, topic: 'crop_production' }).success,
    ).toBe(true);
  });

  it('refuses a card with neither, none, too many or an unknown one, each with its sentence', () => {
    const noTopics = { ...card, topics: undefined };
    expect(reason(learningResourceInputSchema, noTopics, 'topics')).toBe(
      LEARNING_WORKFLOW_MESSAGES.topicsRequired,
    );
    expect(reason(learningResourceInputSchema, { ...card, topics: [] }, 'topics')).toBe(
      LEARNING_WORKFLOW_MESSAGES.topicsRequired,
    );
    expect(
      reason(
        learningResourceInputSchema,
        { ...card, topics: ['crops', 'livestock', 'other', 'post_harvest', 'climate_weather'] },
        'topics',
      ),
    ).toBe(LEARNING_WORKFLOW_MESSAGES.topicsTooMany);
    expect(reason(learningResourceInputSchema, { ...card, topics: ['finance'] }, 'topics.0')).toBe(
      LEARNING_WORKFLOW_MESSAGES.topicsUnknown,
    );
  });

  it('drops a repeated topic', () => {
    const parsed = learningResourceInputSchema.parse({ ...card, topics: ['crops', 'crops'] });
    expect(parsed.topics).toEqual(['crops']);
  });
});

describe('translations', () => {
  it('keeps an Arabic title and summary, and stores a blank one as not translated', () => {
    const parsed = learningResourceInputSchema.parse({
      ...card,
      title_ar: ' دليل زراعة الذرة ',
      description_ar: '',
    });
    expect(parsed.title_ar).toBe('دليل زراعة الذرة');
    expect(parsed.description_ar).toBeNull();
  });

  it('refuses an Arabic title over the limit with its own sentence', () => {
    expect(
      reason(learningResourceInputSchema, { ...card, title_ar: 'ع'.repeat(201) }, 'title_ar'),
    ).toBe(LEARNING_WORKFLOW_MESSAGES.titleArTooLong);
  });
});

describe('the move body', () => {
  it('accepts each move; a return needs a note and nothing else carries one', () => {
    expect(learningTransitionSchema.safeParse({ action: 'publish' }).success).toBe(true);
    expect(
      learningTransitionSchema.safeParse({ action: 'return', note: 'Add the Arabic summary.' })
        .success,
    ).toBe(true);
    expect(reason(learningTransitionSchema, { action: 'return' }, 'note')).toBe(
      LEARNING_WORKFLOW_MESSAGES.noteRequired,
    );
    expect(reason(learningTransitionSchema, { action: 'return', note: ' ok ' }, 'note')).toBe(
      LEARNING_WORKFLOW_MESSAGES.noteRequired,
    );
    expect(reason(learningTransitionSchema, { action: 'publish', note: 'Fine.' }, 'note')).toBe(
      LEARNING_WORKFLOW_MESSAGES.noteNotExpected,
    );
    expect(reason(learningTransitionSchema, { action: 'approve' }, 'action')).toBe(
      LEARNING_WORKFLOW_MESSAGES.actionUnknown,
    );
  });
});

describe('the public filter', () => {
  it('accepts the shared topics and both languages, and treats an empty search as none', () => {
    const parsed = publicGuideFilterSchema.parse({ topic: 'livestock', language: 'ar', q: ' ' });
    expect(parsed).toEqual({ topic: 'livestock', language: 'ar', q: undefined });
  });

  it('refuses an unknown topic or language, a long search and an unknown filter', () => {
    expect(reason(publicGuideFilterSchema, { topic: 'pest_disease' }, 'topic')).toBe(
      LEARNING_WORKFLOW_MESSAGES.topicFilterUnknown,
    );
    expect(reason(publicGuideFilterSchema, { language: 'fr' }, 'language')).toBe(
      LEARNING_WORKFLOW_MESSAGES.languageFilterUnknown,
    );
    expect(reason(publicGuideFilterSchema, { q: 'x'.repeat(101) }, 'q')).toBe(
      LEARNING_WORKFLOW_MESSAGES.searchTooLong,
    );
    expect(publicGuideFilterSchema.safeParse({ status: 'draft' }).success).toBe(false);
  });
});
